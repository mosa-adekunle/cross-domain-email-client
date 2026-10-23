<?php

namespace App\Http\Controllers;

use App\Support\WebsiteContactSignature;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class WebsiteContactController
{
    public function store(Request $request): JsonResponse
    {
        $raw = $request->getContent();
        if (strlen($raw) > 12000) return response()->json(['message' => 'Payload too large.'], 413);
        if (! WebsiteContactSignature::verify(
            (string) config('contact_bridge.secret'),
            (string) $request->header('X-Contact-Timestamp', ''),
            (string) $request->header('X-Contact-Signature', ''),
            $raw,
        )) {
            return response()->json(['message' => 'Unauthorized.'], 401)->header('Cache-Control', 'no-store');
        }
        $payload = $request->validate([
            'id' => ['required', 'uuid'],
            'first_name' => ['required', 'string', 'max:80'],
            'last_name' => ['required', 'string', 'max:80'],
            'email' => ['required', 'email:rfc', 'max:254'],
            'company' => ['nullable', 'string', 'max:160'],
            'interest' => ['required', 'string', 'max:100'],
            'message' => ['required', 'string', 'min:10', 'max:5000'],
        ]);
        $mailbox = DB::table('mailboxes')->where('address', 'hello@madenorth.dev')->first(['id']);
        if (! $mailbox) {
            return response()->json(['message' => 'Target inbox is unavailable.'], 503)
                ->header('Cache-Control', 'no-store');
        }
        $first = trim($payload['first_name']);
        $last = trim($payload['last_name']);
        $name = trim($first.' '.$last);
        $email = Str::lower($payload['email']);
        $body = "New Made North website enquiry\n\n"
            ."Name: ".$name."\nEmail: ".$email."\n"
            ."Company: ".($payload['company'] ?: 'Not provided')."\n"
            ."Interested in: ".$payload['interest']."\n"
            ."Reference: ".$payload['id']."\n\n"
            ."Message:\n".$payload['message'];
        $now = now();
        $created = false;
        DB::transaction(function () use ($payload, $mailbox, $name, $email, $body, $now, &$created): void {
            // A unique submission ID makes repeated requests and ambiguous HTTP
            // timeouts idempotent, without relying on an unindexed Message-ID.
            DB::table('website_contact_deliveries')->insertOrIgnore([
                'id' => $payload['id'], 'created_at' => $now, 'updated_at' => $now,
            ]);
            $delivery = DB::table('website_contact_deliveries')
                ->where('id', $payload['id'])->lockForUpdate()->first();
            if ($delivery->mail_message_id !== null) return;
            $mailMessageId = DB::table('mail_messages')->insertGetId([
                'mailbox_id' => $mailbox->id,
                'direction' => 'incoming', 'folder' => 'inbox',
                'internet_message_id' => '<website-contact.'.$payload['id'].'@madenorth.dev>',
                'from_address' => $email, 'from_name' => $name,
                'subject' => 'Website enquiry: '.mb_substr($payload['interest'], 0, 100),
                'preview_text' => mb_substr($payload['message'], 0, 220),
                'draft_body_text' => $body,
                'delivery_status' => 'received',
                'received_at' => $now, 'is_read' => false,
                'is_starred' => false, 'is_spam' => false,
                'created_at' => $now, 'updated_at' => $now,
            ]);
            DB::table('mail_recipients')->insert([
                'mail_message_id' => $mailMessageId, 'type' => 'to',
                'address' => 'hello@madenorth.dev',
                'created_at' => $now, 'updated_at' => $now,
            ]);
            DB::table('website_contact_deliveries')->where('id', $payload['id'])->update([
                'mail_message_id' => $mailMessageId, 'updated_at' => $now,
            ]);
            $created = true;
        }, 3);
        return response()->json(['status' => 'received'], $created ? 201 : 200)
            ->header('Cache-Control', 'no-store');
    }
}
