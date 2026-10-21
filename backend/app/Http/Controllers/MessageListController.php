<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class MessageListController
{
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
