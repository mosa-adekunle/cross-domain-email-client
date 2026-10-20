<?php

namespace App\Http\Controllers;

use Aws\S3\S3Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;
use ZBateson\MailMimeParser\Message;

class MessageDetailController
{
    public function show(int $id): JsonResponse
    {
        $message = DB::table('mail_messages as m')
            ->join('mailboxes as b', 'b.id', '=', 'm.mailbox_id')
            ->leftJoin('incoming_objects as o', 'o.id', '=', 'm.incoming_object_id')
            ->where('m.id', $id)
            ->whereNull('m.deleted_at')
            ->select(
                'm.id', 'b.address as mailbox_address', 'm.folder',
                'm.from_address', 'm.from_name', 'm.subject', 'm.preview_text',
                'm.received_at', 'm.sent_at', 'm.created_at', 'm.is_read',
                'm.draft_body_text', 'm.draft_body_html', 'm.incoming_object_id',
                'o.r2_bucket', 'o.r2_object_key', 'o.size_bytes'
            )->first();

        if (! $message) {
            abort(404, 'Message not found.');
        }

        $recipients = DB::table('mail_recipients')
            ->where('mail_message_id', $id)->orderBy('id')
            ->get(['type', 'address']);
        $to = $recipients->where('type', 'to')->pluck('address')->implode(', ');
        $cc = $recipients->where('type', 'cc')->pluck('address')->implode(', ');
        $from = trim((string) ($message->from_name ?? '')) ?: (string) ($message->from_address ?? '');
        $body = (string) ($message->draft_body_text ?? '');

        if ($message->incoming_object_id !== null) {
            try {
                $raw = $this->readArchive($message);
                $parsed = Message::from($raw, false);
                $body = (string) ($parsed->getTextContent() ?? '');
                if (trim($body) === '') {
                    $body = $this->htmlToText((string) ($parsed->getHtmlContent() ?? ''));
                }
                $from = (string) ($parsed->getHeaderValue('From') ?: $from);
                $to = (string) ($parsed->getHeaderValue('To') ?: $to);
                $cc = (string) ($parsed->getHeaderValue('Cc') ?: $cc);
            } catch (Throwable $error) {
                report($error);
                return response()->json(['message' => 'Unable to retrieve the archived email. Please try again.'], 502)
                    ->header('Cache-Control', 'no-store');
            }
        } elseif ($body === '') {
            $body = $this->htmlToText((string) ($message->draft_body_html ?? ''));
        }

        // Bound the response; the original MIME and attachments remain in R2.
        $truncated = mb_strlen($body, 'UTF-8') > 500000;
        if ($truncated) {
            $body = mb_substr($body, 0, 500000, 'UTF-8');
        }

        return response()->json([
            'message' => [
                'id' => $message->id,
                'subject' => $message->subject,
                'from' => $from,
                'to' => $to,
                'cc' => $cc,
                'mailbox_address' => $message->mailbox_address,
                'folder' => $message->folder,
                'received_at' => $message->received_at,
                'sent_at' => $message->sent_at,
                'created_at' => $message->created_at,
                'is_read' => (bool) $message->is_read,
                'body' => $body,
                'body_truncated' => $truncated,
            ],
        ])->header('Cache-Control', 'no-store');
    }

    public function markRead(int $id): JsonResponse
    {
        $updated = DB::table('mail_messages')
            ->where('id', $id)->whereNull('deleted_at')
            ->update(['is_read' => true, 'updated_at' => now()]);
        if ($updated === 0 && ! DB::table('mail_messages')->where('id', $id)->whereNull('deleted_at')->exists()) {
            abort(404, 'Message not found.');
        }
        return response()->json(['message' => 'Marked as read.'])->header('Cache-Control', 'no-store');
    }

    private function readArchive(object $item): string
    {
        $account = (string) config('mailarchive.account_id');
        $key = (string) config('mailarchive.access_key_id');
        $secret = (string) config('mailarchive.secret_access_key');
        $bucket = (string) config('mailarchive.bucket');
        $max = (int) config('mailarchive.max_bytes');

        if ($account === '' || $key === '' || $secret === '' || $bucket === '' ||
            $bucket !== $item->r2_bucket || ! $item->r2_object_key ||
            ($item->size_bytes !== null && $item->size_bytes > $max)) {
            throw new \RuntimeException('Archived email is not available.');
        }

        $s3 = new S3Client([
            'version' => 'latest',
            'region' => 'auto',
            'endpoint' => 'https://'.$account.'.r2.cloudflarestorage.com',
            'use_path_style_endpoint' => true,
            'credentials' => ['key' => $key, 'secret' => $secret],
            'http' => ['timeout' => 45, 'connect_timeout' => 10],
        ]);
        $object = $s3->getObject(['Bucket' => $bucket, 'Key' => $item->r2_object_key]);
        $raw = (string) $object['Body'];
        if (strlen($raw) > $max) {
            throw new \RuntimeException('Archived email exceeds configured size limit.');
        }
        return $raw;
    }

    private function htmlToText(string $html): string
    {
        // Never execute email HTML in the browser or load remote resources.
        $clean = preg_replace('~<(script|style|head|svg|iframe|object)\b[^>]*>.*?</\1\s*>~is', '', $html) ?? $html;
        $lines = preg_replace('~<\s*br\b[^>]*>|</\s*(?:p|div|h[1-6]|li|tr)\s*>~i', "\n", $clean) ?? $clean;
        return trim(html_entity_decode(strip_tags($lines), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }
}
