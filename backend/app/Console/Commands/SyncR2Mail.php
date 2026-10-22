<?php

namespace App\Console\Commands;

use App\Support\SenderIdentity;
use Aws\S3\S3Client;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;
use ZBateson\MailMimeParser\Message;

class SyncR2Mail extends Command
{
    protected $signature = 'mail:sync-r2
        {--mode=reconcile : incremental (checkpointed) or reconcile (full replay)}
        {--limit=100 : Maximum new/retry objects to attempt (1-500)}
        {--dry-run : Check the object listing without changing the database}';

    protected $description = 'Idempotently synchronize raw R2 email archives into PostgreSQL';

    private const LOCK_ID = 2010261020;
    private const CHECKPOINT = 'incoming-v2';
    private const ORDERED_PREFIX = 'incoming/v2/';

    public function handle(): int
    {
        $mode = (string) $this->option('mode');
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT);
        if (! in_array($mode, ['incremental', 'reconcile'], true) || $limit === false || $limit < 1 || $limit > 500) {
            $this->error('Use --mode=incremental|reconcile and --limit=1..500.');
            return self::FAILURE;
        }

        $account = (string) config('mailarchive.account_id');
        $accessKey = (string) config('mailarchive.access_key_id');
        $secret = (string) config('mailarchive.secret_access_key');
        $bucket = (string) config('mailarchive.bucket');
        if ($account === '' || $accessKey === '' || $secret === '' || $bucket === '') {
            $this->error('Private R2 read credentials are not configured.');
            return self::FAILURE;
        }

        try {
            // PostgreSQL session advisory lock protects BOTH timers, manually
            // triggered imports and any other concurrent importer process.
            // It releases automatically if the PHP process dies.
            $row = DB::selectOne('SELECT pg_try_advisory_lock(?) AS acquired', [self::LOCK_ID]);
            if (! in_array($row?->acquired, [true, 1, '1', 't'], true)) {
                $this->line('R2 sync: another importer is already running; skipping.');
                return self::SUCCESS;
            }
        } catch (Throwable $error) {
            Log::error('R2 importer could not obtain PostgreSQL advisory lock', ['type' => get_class($error)]);
            return self::FAILURE;
        }

        try {
            $client = new S3Client([
                'version' => 'latest',
                'region' => 'auto',
                'endpoint' => 'https://'.$account.'.r2.cloudflarestorage.com',
                'use_path_style_endpoint' => true,
                'credentials' => ['key' => $accessKey, 'secret' => $secret],
                'http' => ['timeout' => 45, 'connect_timeout' => 10],
            ]);
            return $this->synchronize($client, $bucket, $mode, $limit, (bool) $this->option('dry-run'));
        } catch (Throwable $error) {
            // Do not log the raw MIME, address headers, object key or credentials.
            Log::error('R2 mail synchronization aborted', ['type' => get_class($error)]);
            $this->error('R2 synchronization failed; archived emails remain safe for retry.');
            return self::FAILURE;
        } finally {
            DB::select('SELECT pg_advisory_unlock(?)', [self::LOCK_ID]);
        }
    }

    private function synchronize(S3Client $client, string $bucket, string $mode, int $limit, bool $dryRun): int
    {
        $discovered = 0;
        $imported = 0;
        $skipped = 0;
        $failed = 0;
        $attempted = 0;
        $checkpoint = DB::table('r2_sync_checkpoints')->where('name', self::CHECKPOINT)->first();
        $cursor = $mode === 'incremental' ? ($checkpoint?->last_object_key ?: null) : null;

        // A failed key is retained in PostgreSQL before advancing the cursor.
        // Retry only when its exponential backoff has expired. Reserve at
        // least half of each run's budget for newly arrived mail.
        if (! $dryRun) {
            $retryBudget = min(20, intdiv($limit, 2));
            $retries = DB::table('r2_import_retries')
                ->where('next_attempt_at', '<=', now())
                ->orderBy('next_attempt_at')
                ->limit($retryBudget)
                ->get();
            foreach ($retries as $retry) {
                $identity = (string) $retry->object_identity_sha256;
                if ($this->alreadyProcessed($identity)) {
                    DB::table('r2_import_retries')->where('object_identity_sha256', $identity)->delete();
                    $skipped++;
                    continue;
                }
                $attempted++;
                if ($this->attemptImport($client, $bucket, (string) $retry->r2_object_key, $identity, (int) $retry->size_bytes)) {
                    $imported++;
                } else {
                    $failed++;
                }
            }
        }

        $prefix = $mode === 'incremental' ? self::ORDERED_PREFIX : (string) config('mailarchive.prefix', 'incoming/');
        $token = null;
        $complete = true;
        do {
            $params = ['Bucket' => $bucket, 'Prefix' => $prefix, 'MaxKeys' => 200];
            if ($token !== null) {
                $params['ContinuationToken'] = $token;
            } elseif ($cursor !== null) {
                // R2's S3-compatible ListObjectsV2 supports StartAfter.
                $params['StartAfter'] = $cursor;
            }
            $page = $client->listObjectsV2($params);
            foreach ($page['Contents'] ?? [] as $item) {
                $key = (string) ($item['Key'] ?? '');
                if (! str_ends_with($key, '.eml')) {
                    if ($mode === 'incremental') $cursor = $key;
                    continue;
                }

                $identity = hash('sha256', $bucket."\0".$key);
                if ($this->alreadyProcessed($identity)) {
                    $skipped++;
                    if ($mode === 'incremental') $cursor = $key;
                    continue;
                }
                // Failed objects are retried from the durable queue, not
                // repeatedly on every listing or before backoff expires.
                if (! $dryRun && DB::table('r2_import_retries')->where('object_identity_sha256', $identity)->exists()) {
                    if ($mode === 'incremental') $cursor = $key;
                    continue;
                }
                if ($attempted >= $limit) {
                    $complete = false;
                    break;
                }

                $discovered++;
                $attempted++;
                if (! $dryRun) {
                    if ($this->attemptImport($client, $bucket, $key, $identity, (int) ($item['Size'] ?? 0))) {
                        $imported++;
                    } else {
                        $failed++;
                    }
                }
                if ($mode === 'incremental') $cursor = $key;
            }

            // Save only after imported/failed messages are durably recorded.
            // A mid-page crash replays earlier entries idempotently.
            if ($mode === 'incremental' && ! $dryRun) {
                $this->saveCheckpoint($cursor);
            }
            if (! $complete) break;
            $token = ! empty($page['IsTruncated']) ? ($page['NextContinuationToken'] ?? null) : null;
        } while ($token !== null);

        if ($mode === 'reconcile' && $complete && ! $dryRun) {
            DB::table('r2_sync_checkpoints')->updateOrInsert(
                ['name' => self::CHECKPOINT],
                ['last_reconcile_at' => now(), 'updated_at' => now(), 'created_at' => $checkpoint?->created_at ?? now()]
            );
        }

        $this->info(sprintf(
            'R2 sync (%s): %d discovered, %d imported, %d already imported, %d failed, %d retries pending.',
            $mode, $discovered, $imported, $skipped, $failed, DB::table('r2_import_retries')->count()
        ));
        // Failed items are queued for retry rather than blocking future mail.
        // Non-zero exit still alerts systemd/journald to the failed run.
        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function saveCheckpoint(?string $key): void
    {
        DB::table('r2_sync_checkpoints')->updateOrInsert(
            ['name' => self::CHECKPOINT],
            ['last_object_key' => $key, 'last_poll_at' => now(), 'updated_at' => now()]
        );
    }

    private function alreadyProcessed(string $identity): bool
    {
        return DB::table('incoming_objects')
            ->where('object_identity_sha256', $identity)
            ->where('processing_status', 'processed')->exists();
    }

    private function attemptImport(S3Client $client, string $bucket, string $key, string $identity, int $size): bool
    {
        try {
            $this->importObject($client, $bucket, $key, $identity, $size);
            DB::table('r2_import_retries')->where('object_identity_sha256', $identity)->delete();
            return true;
        } catch (Throwable $error) {
            // Persist failure BEFORE cursor movement. If persisting this
            // record fails, abort the job, so the key is not skipped.
            $old = DB::table('r2_import_retries')->where('object_identity_sha256', $identity)->first();
            $attempts = (int) ($old?->attempt_count ?? 0) + 1;
            $seconds = min(3600, 60 * (2 ** min($attempts - 1, 6)));
            DB::table('r2_import_retries')->updateOrInsert(
                ['object_identity_sha256' => $identity],
                [
                    'r2_bucket' => $bucket,
                    'r2_object_key' => $key,
                    'size_bytes' => $size,
                    'attempt_count' => $attempts,
                    'last_error_type' => mb_substr(get_class($error), 0, 200),
                    'next_attempt_at' => now()->addSeconds($seconds),
                    'updated_at' => now(),
                    'created_at' => $old?->created_at ?? now(),
                ]
            );
            Log::warning('R2 email import queued for retry', [
                'object_identity_sha256' => $identity,
                'attempt' => $attempts,
                'error_type' => get_class($error),
            ]);
            return false;
        }
    }

    private function importObject(S3Client $client, string $bucket, string $key, string $identity, int $size): void
    {
        if ($size > (int) config('mailarchive.max_bytes')) {
            throw new \RuntimeException('Archived message exceeds maximum size.');
        }
        $result = $client->getObject(['Bucket' => $bucket, 'Key' => $key]);
        $metadata = array_change_key_case((array) ($result['Metadata'] ?? []), CASE_LOWER);
        $recipient = strtolower(trim((string) ($metadata['recipient'] ?? '')));
        if (strlen($recipient) > 320 || ! filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            throw new \RuntimeException('Invalid envelope recipient metadata.');
        }
        $mailbox = DB::table('mailboxes')->where('address', $recipient)->first();
        if (! $mailbox) {
            // Accept unknown local parts only for the explicitly owned domains.
            // Keep the actual envelope recipient for display, search and audit;
            // do not invent thousands of mailboxes for spam or typos.
            $domain = strtolower((string) substr(strrchr($recipient, '@') ?: '', 1));
            if (in_array($domain, config('catchall_domains', []), true)) {
                $mailbox = DB::table('mailboxes')->where('address', 'catchall@'.$domain)->first();
            }
        }
        if (! $mailbox) {
            throw new \RuntimeException('Archived recipient has no matching mailbox.');
        }
        $raw = (string) $result['Body'];
        if (strlen($raw) > (int) config('mailarchive.max_bytes')) {
            throw new \RuntimeException('Archived message exceeds maximum size.');
        }
        $parsed = Message::from($raw, false);
        $subject = mb_substr((string) ($parsed->getSubject() ?? ''), 0, 998);
        $messageId = mb_substr((string) ($parsed->getHeaderValue('Message-ID') ?? ''), 0, 998);
        $replyToId = mb_substr((string) ($parsed->getHeaderValue('In-Reply-To') ?? ''), 0, 998);
        $sender = SenderIdentity::fromMessage($parsed, (string) ($metadata['envelope_from'] ?? ''));
        $fromAddress = $sender['email'];
        $fromName = $sender['name'];
        $plain = (string) ($parsed->getTextContent() ?? '');
        if ($plain === '') $plain = strip_tags((string) ($parsed->getHtmlContent() ?? ''));
        $preview = mb_substr(trim(preg_replace('/\s+/u', ' ', $plain) ?? ''), 0, 500);
        $receivedAt = (string) ($metadata['received_at'] ?? now()->toIso8601String());
        try {
            $date = \Illuminate\Support\Carbon::parse($receivedAt);
        } catch (Throwable) {
            $date = now();
        }

        DB::transaction(function () use ($bucket, $key, $identity, $mailbox, $recipient, $subject, $messageId, $replyToId, $fromAddress, $fromName, $preview, $raw, $date): void {
            $now = now();
            DB::table('incoming_objects')->insertOrIgnore([
                'object_identity_sha256' => $identity,
                'r2_bucket' => $bucket,
                'r2_object_key' => $key,
                'raw_sha256' => hash('sha256', $raw),
                'size_bytes' => strlen($raw),
                'processing_status' => 'pending',
                'received_at' => $date,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $object = DB::table('incoming_objects')->where('object_identity_sha256', $identity)->lockForUpdate()->first();
            if (! $object || $object->processing_status === 'processed') return;
            $threadId = null;
            if ($replyToId !== '') {
                $existing = DB::table('mail_messages')->where('mailbox_id', $mailbox->id)
                    ->where('internet_message_id', $replyToId)->first();
                $threadId = $existing?->mail_thread_id;
            }
            if ($threadId === null) {
                $threadId = DB::table('mail_threads')->insertGetId([
                    'mailbox_id' => $mailbox->id, 'subject' => $subject,
                    'root_message_id' => $messageId !== '' ? $messageId : null,
                    'last_message_at' => $date, 'created_at' => $now, 'updated_at' => $now,
                ]);
            } else {
                DB::table('mail_threads')->where('id', $threadId)
                    ->update(['last_message_at' => $date, 'updated_at' => $now]);
            }
            $mailMessageId = DB::table('mail_messages')->insertGetId([
                'mailbox_id' => $mailbox->id,
                'mail_thread_id' => $threadId,
                'incoming_object_id' => $object->id,
                'direction' => 'incoming',
                'folder' => 'inbox',
                'internet_message_id' => $messageId !== '' ? $messageId : null,
                'in_reply_to' => $replyToId !== '' ? $replyToId : null,
                'from_address' => $fromAddress, 'from_name' => $fromName,
                'subject' => $subject,
                'preview_text' => $preview,
                'received_at' => $date,
                'is_read' => false,
                'is_starred' => false,
                'is_spam' => false,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('mail_recipients')->insert([
                'mail_message_id' => $mailMessageId, 'type' => 'to',
                'address' => $recipient, 'created_at' => $now, 'updated_at' => $now,
            ]);
            DB::table('incoming_objects')->where('id', $object->id)->update([
                'processing_status' => 'processed',
                'attempt_count' => $object->attempt_count + 1,
                'processed_at' => $now, 'last_error' => null, 'updated_at' => $now,
            ]);
        });
    }
}
