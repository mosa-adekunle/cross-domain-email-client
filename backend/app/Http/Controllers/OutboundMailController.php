<?php

namespace App\Http\Controllers;

use App\Support\OutboundMessageData;
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
                'draft_body_text' => $data['body_text'], 'in_reply_to' => $data['in_reply_to'],
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
                'draft_body_text' => $data['body_text'], 'in_reply_to' => $data['in_reply_to'],
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
            return compact('draft', 'mailbox', 'to', 'cc', 'bcc', 'internetId', 'attempt');
        });

        try {
            Mail::mailer('smtp')->raw((string) $outbound['draft']->draft_body_text, function ($mail) use ($outbound): void {
                $mail->from($outbound['mailbox']->address, $this->senderName($outbound['mailbox']))
                    ->to($outbound['to'])
                    ->subject((string) ($outbound['draft']->subject ?? ''));
                if ($outbound['cc']) $mail->cc($outbound['cc']);
                if ($outbound['bcc']) $mail->bcc($outbound['bcc']);
                $headers = $mail->getSymfonyMessage()->getHeaders();
                $headers->addIdHeader('Message-ID', trim($outbound['internetId'], '<>'));
                $replyId = OutboundMessageData::singleMessageId((string) ($outbound['draft']->in_reply_to ?? ''));
                if ($replyId) $headers->addIdHeader('In-Reply-To', trim($replyId, '<>'));
            });
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
            ->first(['id', 'address', 'display_name']);
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
