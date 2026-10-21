<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class MessageListController
{
    public function unreadCount(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'mailbox_id' => ['sometimes', 'integer', Rule::exists('mailboxes', 'id')],
        ]);
        $query = DB::table('mail_messages')
            ->where('folder', 'inbox')
            ->where('is_read', false)
            ->whereNull('deleted_at');
        if (isset($filters['mailbox_id'])) {
            $query->where('mailbox_id', $filters['mailbox_id']);
        }
        return response()->json(['unread_count' => $query->count()])
            ->header('Cache-Control', 'no-store');
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'folder' => ['sometimes', Rule::in(['inbox', 'sent', 'drafts', 'archive'])],
            'mailbox_id' => ['nullable', 'integer', Rule::exists('mailboxes', 'id')],
            'page' => ['sometimes', 'integer', 'min:1', 'max:10000'],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);
        $folder = $filters['folder'] ?? 'inbox';

        $query = DB::table('mail_messages as m')
            ->join('mailboxes as b', 'b.id', '=', 'm.mailbox_id')
            ->where('m.folder', $folder)
            ->whereNull('m.deleted_at')
            ->select('m.id', 'm.mailbox_id', 'b.address as mailbox_address', 'm.direction', 'm.folder', 'm.from_address', 'm.from_name', 'm.delivery_status', 'm.subject', 'm.preview_text', 'm.received_at', 'm.sent_at', 'm.is_read', 'm.is_starred', 'm.created_at')
            ->selectSub(function ($sub) {
                $sub->from('mail_recipients as r')->whereColumn('r.mail_message_id', 'm.id')
                    ->where('r.type', 'to')->selectRaw("string_agg(r.address, ', ')");
            }, 'to_recipients')
            ->orderByRaw('COALESCE(m.received_at, m.sent_at, m.updated_at, m.created_at) DESC')
            ->orderByDesc('m.id');

        if (isset($filters['mailbox_id'])) {
            $query->where('m.mailbox_id', $filters['mailbox_id']);
        }

        // Search stays scoped to the selected folder and optional mailbox.
        // Bind the pattern instead of interpolating user content into SQL.
        $term = trim((string) ($filters['q'] ?? ''));
        if ($term !== '') {
            $pattern = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term).'%';
            $query->where(function ($search) use ($pattern): void {
                $search->where('m.subject', 'ilike', $pattern)
                    ->orWhere('m.preview_text', 'ilike', $pattern)
                    ->orWhere('m.from_address', 'ilike', $pattern)
                    ->orWhere('m.from_name', 'ilike', $pattern)
                    ->orWhereExists(function ($recipients) use ($pattern): void {
                        $recipients->selectRaw('1')->from('mail_recipients as r')
                            ->whereColumn('r.mail_message_id', 'm.id')
                            ->where('r.address', 'ilike', $pattern);
                    });
            });
        }

        $messages = $query->paginate(25);

        // A Sent/Drafts row shows its recipient, not the sender. Use the
        // newest known incoming display name for matching recipient addresses
        // without an external contact lookup or per-message database queries.
        $addresses = [];
        foreach ($messages->items() as $message) {
            if (! in_array($folder, ['sent', 'drafts'], true)) continue;
            foreach (explode(',', (string) ($message->to_recipients ?? '')) as $address) {
                $email = strtolower(trim($address));
                if (filter_var($email, FILTER_VALIDATE_EMAIL)) $addresses[$email] = true;
            }
        }
        $knownNames = [];
        if ($addresses) {
            $known = DB::table('mail_messages')
                ->selectRaw('DISTINCT ON (LOWER(from_address)) LOWER(from_address) AS email, from_name')
                ->whereIn(DB::raw('LOWER(from_address)'), array_keys($addresses))
                ->whereNotNull('from_name')
                ->where('from_name', '<>', '')
                ->whereNull('deleted_at')
                ->orderByRaw('LOWER(from_address), id DESC')
                ->get();
            foreach ($known as $contact) {
                $knownNames[$contact->email] = $contact->from_name;
            }
        }
        foreach ($messages->items() as $message) {
            $recipients = array_values(array_filter(array_map('trim', explode(',', (string) ($message->to_recipients ?? '')))));
            $first = $recipients[0] ?? '';
            $message->to_contact_email = $first;
            $message->to_contact_name = $knownNames[strtolower($first)] ?? null;
            $message->to_recipient_count = count($recipients);
        }

        return response()->json([
            'messages' => $messages->items(),
            'pagination' => [
                'current_page' => $messages->currentPage(),
                'last_page' => $messages->lastPage(),
                'per_page' => $messages->perPage(),
                'total' => $messages->total(),
            ],
        ])->header('Cache-Control', 'no-store');
    }
}
