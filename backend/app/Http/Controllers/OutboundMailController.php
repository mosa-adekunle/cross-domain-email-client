<?php

namespace App\Http\Controllers;

use App\Mail\OutboundDraftMail;
use App\Support\ArchivedMimeAttachments;
use App\Support\OutboundMessageData;
use App\Support\OutboundSenderAuthorization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

class OutboundMailController
{
    public function status(): JsonResponse
    {
        $this->requireAdmin();
        $senders = DB::table('mailboxes')
            ->whereIn('mail_domain_id', DB::table('mail_domains')
                ->select('id')->whereIn('domain_name', config('outbound.allowed_domains', [])))
            ->where('local_part', '<>', 'catchall')
            ->where(function ($query): void {
                // Made North requires explicit per-mailbox outbound approval,
                // even for legacy rows with no JSON settings.
                $query->whereNotIn('mail_domain_id', DB::table('mail_domains')
                    ->select('id')->where('domain_name', 'madenorth.dev'))
                    ->orWhereRaw("settings->'outbound_enabled' = 'true'::jsonb");
            })
            ->where(function ($query): void {
                // Newly staged mailboxes cannot be offered for sending until
                // their inbound routes and sender authorization are checked.
                // Existing production mailboxes without the flag are unchanged.
                $query->whereNull('settings')
                    ->orWhereRaw("COALESCE(settings->'catchall', 'false'::jsonb) <> 'true'::jsonb AND (CASE WHEN jsonb_exists(settings, 'outbound_enabled') THEN settings->'outbound_enabled' = 'true'::jsonb ELSE COALESCE(settings->'onboarding_pending', 'false'::jsonb) <> 'true'::jsonb END)");
            })
            ->orderBy('address')
            ->get(['id', 'address', 'display_name']);
        return response()->json([
            'configured' => OutboundMessageData::configured() && $senders->isNotEmpty(),
            'transport' => 'smtp',
            'provider' => config('outbound.provider_label', 'smtp'),
            'senders' => $senders,
        ])->header('Cache-Control', 'no-store');
    }

    public function createDraft(Request $request): JsonResponse
    {
        $this->requireAdmin();
        $data = $this->validatedDraft($request);
        $id = DB::transaction(function () use ($data): int {
            $mailbox = $this->mailbox($data['mailbox_id']);
            $now = now();
            $id = DB::table('mail_messages')->insertGetId([
                'mailbox_id' => $mailbox->id,
                'direction' => 'draft', 'folder' => 'drafts',
                'from_address' => $mailbox->address, 'from_name' => $this->senderName($mailbox),
                'subject' => $data['subject'], 'preview_text' => mb_substr($data['body_text'], 0, 220),
                'draft_body_text' => $data['body_text'], 'draft_body_html' => $data['body_html'], 'in_reply_to' => $data['in_reply_to'],
                'delivery_status' => 'draft', 'is_read' => true,
                'created_at' => $now, 'updated_at' => $now,
            ]);
            $this->storeRecipients($id, $data);
            return $id;
        });

        return response()->json(['id' => $id, 'message' => 'Draft saved.'], 201)
            ->header('Cache-Control', 'no-store');
    }

    public function updateDraft(Request $request, int $id): JsonResponse
    {
        $this->requireAdmin();
        $data = $this->validatedDraft($request);
        DB::transaction(function () use ($id, $data): void {
            $existing = DB::table('mail_messages')->where('id', $id)->whereNull('deleted_at')
                ->lockForUpdate()->first();
            if (! $existing || $existing->folder !== 'drafts' || $existing->direction !== 'draft'
                || $existing->delivery_status !== 'draft') {
                abort(409, 'This draft cannot be modified.');
            }
            $mailbox = $this->mailbox($data['mailbox_id']);
            DB::table('mail_messages')->where('id', $id)->update([
                'mailbox_id' => $mailbox->id,
                'from_address' => $mailbox->address, 'from_name' => $this->senderName($mailbox),
                'subject' => $data['subject'], 'preview_text' => mb_substr($data['body_text'], 0, 220),
                'draft_body_text' => $data['body_text'], 'draft_body_html' => $data['body_html'], 'in_reply_to' => $data['in_reply_to'],
                'delivery_status' => 'draft', 'updated_at' => now(),
            ]);
            $this->storeRecipients($id, $data);
        });
        return response()->json(['id' => $id, 'message' => 'Draft saved.'])
            ->header('Cache-Control', 'no-store');
    }

    public function deleteDraft(int $id): JsonResponse
    {
        $this->requireAdmin();
        DB::transaction(function () use ($id): void {
            $draft = DB::table('mail_messages')->where('id', $id)->whereNull('deleted_at')
                ->lockForUpdate()->first();
            if (! $draft || $draft->folder !== 'drafts' || $draft->delivery_status === 'sending') {
                abort(409, 'Draft cannot be deleted.');
            }
            DB::table('mail_messages')->where('id', $id)->update([
                'deleted_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('outbound_attachment_blobs')->where('mail_message_id', $id)->delete();
        });
        return response()->json(['message' => 'Draft deleted.'])
            ->header('Cache-Control', 'no-store');
    }

    public function sendDraft(int $id): JsonResponse
    {
        $this->requireAdmin();
        if (! OutboundMessageData::configured()) {
            return response()->json([
                'message' => 'Outgoing mail is not configured. Save your draft and set up SMTP and verified sender domains first.',
            ], 503)->header('Cache-Control', 'no-store');
        }

        // The transition to 'sending' commits BEFORE network I/O. A repeated
        // browser POST cannot start a second SMTP submission for the same draft.
        $outbound = DB::transaction(function () use ($id): array {
            $draft = DB::table('mail_messages')->where('id', $id)->whereNull('deleted_at')
                ->lockForUpdate()->first();
            if (! $draft || $draft->folder !== 'drafts' || $draft->direction !== 'draft'
                || $draft->delivery_status !== 'draft') {
                abort(409, 'This draft is already being sent, or its delivery status is uncertain. It cannot be submitted again.');
            }
            $mailbox = $this->mailbox((int) $draft->mailbox_id);
            $senderDomain = strtolower(substr($mailbox->address, strrpos($mailbox->address, '@') + 1));
            if (! OutboundSenderAuthorization::allowed($mailbox->settings, $mailbox->local_part, $senderDomain)) {
                abort(403, 'This address is not authorized for outgoing mail.');
            }
            if (! OutboundMessageData::domainAllowed($mailbox->address)) {
                abort(403, 'This sender domain has not been enabled for outgoing mail.');
            }
            $recipients = DB::table('mail_recipients')->where('mail_message_id', $id)
                ->get(['type', 'address'])->groupBy('type');
            $to = $recipients->get('to', collect())->pluck('address')->all();
            $cc = $recipients->get('cc', collect())->pluck('address')->all();
            $bcc = $recipients->get('bcc', collect())->pluck('address')->all();
            OutboundMessageData::validateReady([
                'to' => $to, 'cc' => $cc, 'bcc' => $bcc,
                'subject' => $draft->subject, 'body_text' => $draft->draft_body_text,
            ]);
            $domain = substr($mailbox->address, strrpos($mailbox->address, '@') + 1);
            $internetId = '<'.Str::uuid().'@'.$domain.'>';
            $stamp = now();
            DB::table('mail_messages')->where('id', $id)->update([
                'delivery_status' => 'sending', 'internet_message_id' => $internetId,
                'updated_at' => $stamp,
            ]);
            $attempt = DB::table('mail_delivery_attempts')->insertGetId([
                'mail_message_id' => $id, 'provider' => (string) config('outbound.provider_label', 'smtp'),
                'status' => 'sending', 'attempted_at' => $stamp,
                'created_at' => $stamp, 'updated_at' => $stamp,
            ]);
            $files = DB::select("SELECT filename, content_type, encode(content, 'base64') AS encoded_content FROM outbound_attachment_blobs WHERE mail_message_id = ? ORDER BY id", [$id]);
            return compact('draft', 'mailbox', 'to', 'cc', 'bcc', 'internetId', 'attempt', 'files');
        });

        try {
            $draftMail = new OutboundDraftMail(
                (string) ($outbound['draft']->draft_body_html ?? ''),
                (string) ($outbound['draft']->draft_body_text ?? ''),
                $outbound['files'],
                $outbound['internetId'],
                OutboundMessageData::singleMessageId((string) ($outbound['draft']->in_reply_to ?? ''))
            );
            $draftMail->from($outbound['mailbox']->address, $this->senderName($outbound['mailbox']))
                ->to($outbound['to'])->subject((string) ($outbound['draft']->subject ?? ''));
            if ($outbound['cc']) $draftMail->cc($outbound['cc']);
            if ($outbound['bcc']) $draftMail->bcc($outbound['bcc']);
            Mail::mailer('smtp')->send($draftMail);
        } catch (Throwable $error) {
            // After the SMTP attempt begins, an exception does NOT establish
            // that delivery failed. SMTP may accept DATA then drop the connection.
            // Never auto-retry an uncertain send: that could duplicate email.
            Log::warning('SMTP delivery cannot be confirmed', [
                'message_id' => $id, 'exception_type' => get_class($error),
            ]);
            DB::transaction(function () use ($id, $outbound): void {
                DB::table('mail_messages')->where('id', $id)->update([
                    'delivery_status' => 'unknown', 'updated_at' => now(),
                ]);
                DB::table('mail_delivery_attempts')->where('id', $outbound['attempt'])->update([
                    'status' => 'unknown',
                    'error_summary' => 'SMTP submission could not be confirmed. Do not resend without checking the provider.',
                    'updated_at' => now(),
                ]);
            });
            return response()->json([
                'id' => $id,
                'message' => 'SMTP delivery could not be confirmed. This draft is preserved; check the provider before attempting a new message.',
                'delivery_status' => 'unknown',
            ], 502)->header('Cache-Control', 'no-store');
        }

        DB::transaction(function () use ($id, $outbound): void {
            DB::table('mail_messages')->where('id', $id)->update([
                'folder' => 'sent', 'direction' => 'outgoing', 'delivery_status' => 'accepted',
                'sent_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('mail_delivery_attempts')->where('id', $outbound['attempt'])->update([
                'status' => 'accepted', 'updated_at' => now(),
            ]);
        });

        return response()->json([
            'id' => $id,
            'delivery_status' => 'accepted',
            'message' => 'Message accepted by the SMTP provider and saved in Sent. Final inbox delivery depends on the recipient server.',
        ])->header('Cache-Control', 'no-store');
    }

    public function uploadAttachment(Request $request, int $id): JsonResponse
    {
        $this->requireAdmin();
        $request->validate(['file' => ['required', 'file', 'max:5120']]);
        $file = $request->file('file');
        $bytes = file_get_contents($file->getRealPath());
        if ($bytes === false || strlen($bytes) === 0) {
            throw ValidationException::withMessages(['file' => 'The attachment is empty or unreadable.']);
        }
        $filename = ArchivedMimeAttachments::filename($file->getClientOriginalName(), 0);
        $mime = strtolower((string) ($file->getMimeType() ?: 'application/octet-stream'));
        if (! preg_match('~^[a-z0-9.+-]+/[a-z0-9.+-]+$~', $mime)) $mime = 'application/octet-stream';
        $result = DB::transaction(function () use ($id, $bytes, $filename, $mime): object {
            $draft = DB::table('mail_messages')->where('id', $id)->whereNull('deleted_at')
                ->lockForUpdate()->first(['direction', 'folder', 'delivery_status']);
            if (! $draft || $draft->direction !== 'draft' || $draft->folder !== 'drafts' || $draft->delivery_status !== 'draft') {
                abort(409, 'This draft cannot be modified.');
            }
            $count = DB::table('outbound_attachment_blobs')->where('mail_message_id', $id)->count();
            $total = DB::table('outbound_attachment_blobs')->where('mail_message_id', $id)->sum('size_bytes');
            if ($count >= 8 || $total + strlen($bytes) > 15 * 1024 * 1024) {
                throw ValidationException::withMessages(['file' => 'Limit: 8 attachments, 5 MB each, 15 MB total.']);
            }
            return DB::selectOne(
                "INSERT INTO outbound_attachment_blobs (mail_message_id, filename, content_type, size_bytes, content, created_at, updated_at) VALUES (?, ?, ?, ?, decode(?, 'base64'), ?, ?) RETURNING id",
                [$id, $filename, $mime, strlen($bytes), base64_encode($bytes), now(), now()]
            );
        });
        return response()->json([
            'attachment' => ['id' => $result->id, 'index' => $result->id, 'filename' => $filename,
                'content_type' => $mime, 'size_bytes' => strlen($bytes),
                'is_inline' => false, 'can_preview' => in_array($mime, ['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain'], true)],
        ], 201)->header('Cache-Control', 'no-store');
    }

    public function deleteAttachment(int $id, int $attachmentId): JsonResponse
    {
        $this->requireAdmin();
        DB::transaction(function () use ($id, $attachmentId): void {
            $draft = DB::table('mail_messages')->where('id', $id)->whereNull('deleted_at')
                ->lockForUpdate()->first(['direction', 'folder', 'delivery_status']);
            if (! $draft || $draft->direction !== 'draft' || $draft->folder !== 'drafts' || $draft->delivery_status !== 'draft') {
                abort(409, 'This draft cannot be modified.');
            }
            $removed = DB::table('outbound_attachment_blobs')->where('mail_message_id', $id)->where('id', $attachmentId)->delete();
            if (! $removed) abort(404, 'Attachment not found.');
        });
        return response()->json(['message' => 'Attachment removed.'])->header('Cache-Control', 'no-store');
    }

    private function validatedDraft(Request $request): array
    {
        $v = $request->validate([
            'mailbox_id' => ['required', 'integer', Rule::exists('mailboxes', 'id')],
            'to' => ['sometimes', 'array', 'max:30'],
            'to.*' => ['required', 'string', 'email:rfc', 'max:320'],
            'cc' => ['sometimes', 'array', 'max:30'],
            'cc.*' => ['required', 'string', 'email:rfc', 'max:320'],
            'bcc' => ['sometimes', 'array', 'max:30'],
            'bcc.*' => ['required', 'string', 'email:rfc', 'max:320'],
            'subject' => ['nullable', 'string', 'max:998', 'not_regex:/[\\r\\n]/'],
            'body_text' => ['nullable', 'string', 'max:262144'],
            'body_html' => ['nullable', 'string', 'max:262144'],
            'in_reply_to' => ['nullable', 'string', 'max:998'],
        ]);
        $v['subject'] = $v['subject'] ?? '';
        $v['body_text'] = $v['body_text'] ?? '';
        $v['in_reply_to'] = $v['in_reply_to'] ?? '';
        $out = OutboundMessageData::normalize($v);
        if (count($out['to']) + count($out['cc']) + count($out['bcc']) > 30) {
            throw ValidationException::withMessages(['to' => 'Limit each message to 30 recipients.']);
        }
        if (trim($v['in_reply_to']) !== '' && $out['in_reply_to'] === null) {
            throw ValidationException::withMessages(['in_reply_to' => 'Invalid reply message identifier.']);
        }
        return $out;
    }

    private function mailbox(int $id): object
    {
        $mailbox = DB::table('mailboxes')->where('id', $id)
            ->first(['id', 'address', 'local_part', 'display_name', 'settings']);
        if (! $mailbox) abort(404, 'Sender mailbox not found.');
        return $mailbox;
    }

    private function senderName(object $mailbox): string
    {
        $name = (string) ($mailbox->display_name ?: $mailbox->address);
        return trim(preg_replace('/[\\x00-\\x1F\\x7F]/', '', $name) ?? '') ?: $mailbox->address;
    }

    private function storeRecipients(int $id, array $data): void
    {
        DB::table('mail_recipients')->where('mail_message_id', $id)->delete();
        $rows = [];
        foreach (['to', 'cc', 'bcc'] as $type) {
            foreach ($data[$type] as $address) {
                $rows[] = [
                    'mail_message_id' => $id, 'type' => $type, 'address' => $address,
                    'created_at' => now(), 'updated_at' => now(),
                ];
            }
        }
        if ($rows) DB::table('mail_recipients')->insert($rows);
    }

    private function requireAdmin(): void
    {
        $user = request()->user('web');
        abort_unless($user && $user->is_admin && $user->is_active, 403, 'Administrator access required.');
    }
}
