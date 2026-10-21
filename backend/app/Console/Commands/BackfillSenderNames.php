<?php

namespace App\Console\Commands;

use App\Support\SenderIdentity;
use Aws\S3\S3Client;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;
use ZBateson\MailMimeParser\Message;

/**
 * One-time, read-only R2 lookups for previously imported sender names.
 * Existing mail content and delivery state are left untouched.
 */
class BackfillSenderNames extends Command
{
    protected $signature = 'mail:backfill-sender-names {--limit=200 : Maximum archived messages to inspect (1-500)}';
    protected $description = 'Recover sender display names from already imported private R2 email archives';

    public function handle(): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT);
        if ($limit === false || $limit < 1 || $limit > 500) {
            $this->error('Use --limit=1..500.');
            return self::FAILURE;
        }

        $account = (string) config('mailarchive.account_id');
        $key = (string) config('mailarchive.access_key_id');
        $secret = (string) config('mailarchive.secret_access_key');
        $bucket = (string) config('mailarchive.bucket');
        if ($account === '' || $key === '' || $secret === '' || $bucket === '') {
            $this->error('Private R2 read credentials are not configured.');
            return self::FAILURE;
        }

        $client = new S3Client([
            'version' => 'latest',
            'region' => 'auto',
            'endpoint' => 'https://'.$account.'.r2.cloudflarestorage.com',
            'use_path_style_endpoint' => true,
            'credentials' => ['key' => $key, 'secret' => $secret],
            'http' => ['timeout' => 45, 'connect_timeout' => 10],
        ]);
        $rows = DB::table('mail_messages as m')
            ->join('incoming_objects as o', 'o.id', '=', 'm.incoming_object_id')
            ->where('m.direction', 'incoming')
            ->whereNull('m.deleted_at')
            ->whereNull('m.from_name')
            ->where('o.r2_bucket', $bucket)
            ->orderByDesc('m.id')
            ->limit($limit)
            ->get(['m.id', 'o.r2_object_key']);

        $updated = 0;
        $missing = 0;
        $failed = 0;
        foreach ($rows as $row) {
            try {
                $object = $client->getObject(['Bucket' => $bucket, 'Key' => $row->r2_object_key]);
                $raw = (string) $object['Body'];
                if (strlen($raw) > (int) config('mailarchive.max_bytes')) {
                    throw new \RuntimeException('Archived email exceeds size limit.');
                }
                $sender = SenderIdentity::fromMessage(Message::from($raw, false));
                if ($sender['name'] === null) {
                    $missing++;
                    continue;
                }
                $updated += DB::table('mail_messages')
                    ->where('id', $row->id)
                    ->whereNull('from_name')
                    ->update(['from_name' => $sender['name'], 'updated_at' => now()]);
            } catch (Throwable $error) {
                $failed++;
                $this->warn('Unable to recover sender name for message #'.$row->id.' ('.get_class($error).').');
            }
        }
        $this->info(sprintf('Sender names: %d updated, %d without name, %d failed.', $updated, $missing, $failed));
        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
