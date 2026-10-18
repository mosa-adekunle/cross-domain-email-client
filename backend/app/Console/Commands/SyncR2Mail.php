<?php

namespace App\Console\Commands;

use Aws\S3\S3Client;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;
use ZBateson\MailMimeParser\Message;

class SyncR2Mail extends Command
{
    protected $signature = 'mail:sync-r2 {--limit=100 : Maximum new objects to attempt (1-500)} {--dry-run : Check R2 access without updating the database}';
    protected $description = 'Import private R2 raw-email archives into the local PostgreSQL inbox';

    public function handle(): int
    {
        $account = (string) config('mailarchive.account_id');
        $accessKey = (string) config('mailarchive.access_key_id');
        $secret = (string) config('mailarchive.secret_access_key');
        $bucket = (string) config('mailarchive.bucket');
        $prefix = (string) config('mailarchive.prefix');
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT);

        if ($limit === false || $limit < 1 || $limit > 500) {
            $this->error('The --limit value must be between 1 and 500.');
            return self::FAILURE;
        }

        if ($account === '' || $accessKey === '' || $secret === '' || $bucket === '') {
            $this->error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET in the server-only .env file.');
            return self::FAILURE;
        }

        $client = new S3Client([
            'version' => 'latest',
            'region' => 'auto',
            'endpoint' => 'https://'.$account.'.r2.cloudflarestorage.com',
            'use_path_style_endpoint' => true,
            'credentials' => ['key' => $accessKey, 'secret' => $secret],
            'http' => ['timeout' => 45, 'connect_timeout' => 10],
        ]);

        $seen = 0;
        $stored = 0;
        $skipped = 0;
        $failed = 0;
        $token = null;

        try {
            do {
                $params = ['Bucket' => $bucket, 'Prefix' => $prefix, 'MaxKeys' => 200];
                if ($token !== null) {
                    $params['ContinuationToken'] = $token;
                }
                $page = $client->listObjectsV2($params);
                foreach ($page['Contents'] ?? [] as $item) {
                    $key = (string) ($item['Key'] ?? '');
                    if (! str_ends_with($key, '.eml')) {
                        continue;
                    }
                    $identity = hash('sha256', $bucket."\0".$key);
                    if (DB::table('incoming_objects')->where('object_identity_sha256', $identity)->where('processing_status', 'processed')->exists()) {
                        $skipped++;
                        continue;
                    }
                    if (++$seen > $limit) {
                        break 2;
                    }
                    if ($this->option('dry-run')) {
                        $this->line('R2 object discovered; no database updates made.');
                        continue;
                    }
                    try {
                        $this->importObject($client, $bucket, $key, $identity, (int) ($item['Size'] ?? 0));
                        $stored++;
                    } catch (Throwable $error) {
                        $failed++;
                        report($error);
                        $this->warn('An R2 archive could not be imported; it remains in R2 for retry.');
                    }
                }
                $token = ($page['IsTruncated'] ?? false) ? ($page['NextContinuationToken'] ?? null) : null;
            } while ($token !== null);
        } catch (Throwable $error) {
            report($error);
            $this->error('Could not list R2 objects. Verify bucket, endpoint, and read credentials.');
            return self::FAILURE;
        }

        $this->info(sprintf('R2 sync: %d discovered, %d imported, %d already imported, %d failed.', min($seen, $limit), $stored, $skipped, $failed));
        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }

    private function importObject(S3Client $client, string $bucket, string $key, string $identity, int $size): void
    {
        if ($size > (int) config('mailarchive.max_bytes')) {
            throw new \RuntimeException('Archived message exceeds configured maximum.');
        }

        $result = $client->getObject(['Bucket' => $bucket, 'Key' => $key]);
        $metadata = array_change_key_case((array) ($result['Metadata'] ?? []), CASE_LOWER);
        $recipient = strtolower(trim((string) ($metadata['recipient'] ?? '')));
        if (strlen($recipient) > 320 || ! filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            throw new \RuntimeException('Archived email is missing a valid envelope recipient.');
        }

        $mailbox = DB::table('mailboxes')->where('address', $recipient)->first();
        if (! $mailbox) {
            // Do not mutate the archive or invent a new mailbox.
            throw new \RuntimeException('Archived recipient is not configured as a mailbox.');
        }

        $raw = (string) $result['Body'];
        if (strlen($raw) > (int) config('mailarchive.max_bytes')) {
            throw new \RuntimeException('Archived message exceeds configured maximum.');
        }
        $parsed = Message::from($raw, false);
        $subject = mb_substr((string) ($parsed->getSubject() ?? ''), 0, 998);
        $messageId = mb_substr((string) ($parsed->getHeaderValue('Message-ID') ?? ''), 0, 998);
        $replyToId = mb_substr((string) ($parsed->getHeaderValue('In-Reply-To') ?? ''), 0, 998);
        $fromAddress = mb_substr((string) ($parsed->getHeaderValue('From') ?: ($metadata['envelope_from'] ?? '')), 0, 320);
        $plain = (string) ($parsed->getTextContent() ?? '');
        if ($plain === '') {
            $plain = strip_tags((string) ($parsed->getHtmlContent() ?? ''));
        }
        $preview = mb_substr(trim(preg_replace('/\s+/u', ' ', $plain) ?? ''), 0, 500);
        $receivedAt = (string) ($metadata['received_at'] ?? now()->toIso8601String());
        try {
            $date = \Illuminate\Support\Carbon::parse($receivedAt);
        } catch (Throwable) {
            $date = now();
        }

        DB::transaction(function () use ($bucket, $key, $identity, $mailbox, $subject, $messageId, $replyToId, $fromAddress, $preview, $raw, $date): void {
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
            if (! $object || $object->processing_status === 'processed') {
                return;
            }
            $threadId = null;
            if ($replyToId !== '') {
                $existing = DB::table('mail_messages')->where('mailbox_id', $mailbox->id)->where('internet_message_id', $replyToId)->first();
                $threadId = $existing?->mail_thread_id;
            }
            if ($threadId === null) {
                $threadId = DB::table('mail_threads')->insertGetId([
                    'mailbox_id' => $mailbox->id,
                    'subject' => $subject,
                    'root_message_id' => $messageId !== '' ? $messageId : null,
                    'last_message_at' => $date,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                DB::table('mail_threads')->where('id', $threadId)->update(['last_message_at' => $date, 'updated_at' => $now]);
            }
            $mailMessageId = DB::table('mail_messages')->insertGetId([
                'mailbox_id' => $mailbox->id,
                'mail_thread_id' => $threadId,
                'incoming_object_id' => $object->id,
                'direction' => 'incoming',
                'folder' => 'inbox',
                'internet_message_id' => $messageId !== '' ? $messageId : null,
                'in_reply_to' => $replyToId !== '' ? $replyToId : null,
                'from_address' => $fromAddress,
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
                'mail_message_id' => $mailMessageId,
                'type' => 'to',
                'address' => $mailbox->address,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('incoming_objects')->where('id', $object->id)->update([
                'processing_status' => 'processed',
                'attempt_count' => $object->attempt_count + 1,
                'processed_at' => $now,
                'last_error' => null,
                'updated_at' => $now,
            ]);
        });
    }
}
