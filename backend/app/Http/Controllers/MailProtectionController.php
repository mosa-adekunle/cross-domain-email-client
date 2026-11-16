<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class MailProtectionController
{
    public function index(): JsonResponse
    {
        return response()->json([
            'aliases' => DB::table('mail_aliases as a')
                ->join('mailboxes as m', 'm.id', '=', 'a.mailbox_id')
                ->orderBy('a.address')
                ->get(['a.id', 'a.address', 'a.mailbox_id', 'm.address as destination', 'a.is_active']),
            'sender_rules' => DB::table('mail_sender_rules')->orderBy('type')->orderBy('value')
                ->get(['id', 'type', 'value', 'action']),
        ])->header('Cache-Control', 'no-store');
    }

    public function addAlias(Request $request): JsonResponse
    {
        $data = $request->validate([
            'address' => ['required', 'string', 'email:rfc', 'max:320'],
            'mailbox_id' => ['required', 'integer', Rule::exists('mailboxes', 'id')],
        ]);
        $address = strtolower(trim($data['address']));
        $target = DB::table('mailboxes as m')
            ->join('mail_domains as d', 'd.id', '=', 'm.mail_domain_id')
            ->where('m.id', $data['mailbox_id'])->where('m.is_active', true)
            ->first(['m.id', 'm.address', 'd.domain_name']);
        if (! $target || ! str_ends_with($address, '@'.$target->domain_name)) {
            throw ValidationException::withMessages(['address' => 'Alias must use the destination mailbox domain and an active mailbox.']);
        }
        if (DB::table('mailboxes')->where('address', $address)->exists()) {
            throw ValidationException::withMessages(['address' => 'This address already belongs to a mailbox.']);
        }
        if (DB::table('mail_aliases')->where('address', $address)->exists()) {
            throw ValidationException::withMessages(['address' => 'This alias already exists.']);
        }
        $id = DB::table('mail_aliases')->insertGetId([
            'address' => $address, 'mailbox_id' => $target->id, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        return response()->json([
            'id' => $id, 'message' => 'Receiving alias saved. Replying still uses your verified sender identity; no Cloudflare or SMTP settings were changed.',
        ], 201)->header('Cache-Control', 'no-store');
    }

    public function removeAlias(int $id): JsonResponse
    {
        $deleted = DB::table('mail_aliases')->where('id', $id)->delete();
        if (! $deleted) abort(404, 'Alias not found.');
        return response()->json(['message' => 'Alias removed; old messages remain intact.'])
            ->header('Cache-Control', 'no-store');
    }

    public function addRule(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(['address', 'domain'])],
            'value' => ['required', 'string', 'max:320'],
            'action' => ['required', Rule::in(['allow', 'block'])],
        ]);
        $value = strtolower(trim($data['value']));
        if ($data['type'] === 'address' && ! filter_var($value, FILTER_VALIDATE_EMAIL)) {
            throw ValidationException::withMessages(['value' => 'Enter a valid sender email address.']);
        }
        if ($data['type'] === 'domain' && (! filter_var($value, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) || ! str_contains($value, '.'))) {
            throw ValidationException::withMessages(['value' => 'Enter a valid domain (example.com).']);
        }
        DB::table('mail_sender_rules')->updateOrInsert(
            ['type' => $data['type'], 'value' => $value],
            ['action' => $data['action'], 'updated_at' => now(), 'created_at' => now()],
        );
        return response()->json(['message' => 'Sender rule saved. Existing messages were not deleted.'])
            ->header('Cache-Control', 'no-store');
    }

    public function removeRule(int $id): JsonResponse
    {
        if (! DB::table('mail_sender_rules')->where('id', $id)->delete()) {
            abort(404, 'Rule not found.');
        }
        return response()->json(['message' => 'Sender rule removed.'])
            ->header('Cache-Control', 'no-store');
    }
}
