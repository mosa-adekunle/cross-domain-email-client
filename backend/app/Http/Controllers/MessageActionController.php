<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class MessageActionController
{
    /**
     * All actions are scoped to authenticated mailboxes (see routes/api.php).
     * Only a bounded set of server-validated IDs can be mutated per request.
     * A trash operation changes mailbox visibility, NOT the archived R2 bytes.
     */
    public function bulk(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'integer', 'min:1', 'distinct'],
            'action' => ['required', Rule::in(['trash', 'restore', 'archive', 'read', 'unread', 'star', 'unstar'])],
        ]);

        $action = $data['action'];
        $updated = DB::transaction(function () use ($data, $action): int {
            $messages = DB::table('mail_messages')
                ->whereIn('id', $data['ids'])
                ->whereNull('deleted_at')
                ->lockForUpdate()
                ->get(['id', 'folder', 'previous_folder', 'direction', 'delivery_status']);

            if ($messages->count() !== count($data['ids'])) {
                abort(404, 'One or more messages no longer exist. Refresh the list.');
            }

            $now = now();
            $count = 0;
            foreach ($messages as $message) {
                $change = ['updated_at' => $now];
                switch ($action) {
                    case 'trash':
                        if ($message->folder === 'trash') continue 2;
                        if ($message->delivery_status === 'sending') {
                            abort(409, 'A message currently being submitted cannot be moved to Trash.');
                        }
                        $change['previous_folder'] = $message->folder;
                        $change['folder'] = 'trash';
                        break;
                    case 'restore':
                        if ($message->folder !== 'trash') continue 2;
                        $original = $message->previous_folder;
                        if (! in_array($original, ['inbox', 'sent', 'drafts', 'archive'], true)) {
                            $original = $message->direction === 'incoming' ? 'inbox'
                                : ($message->delivery_status === 'draft' ? 'drafts' : 'sent');
                        }
                        $change['folder'] = $original;
                        $change['previous_folder'] = null;
                        break;
                    case 'archive':
                        if ($message->folder !== 'inbox') continue 2;
                        $change['folder'] = 'archive';
                        break;
                    case 'read':
                    case 'unread':
                        $change['is_read'] = $action === 'read';
                        break;
                    case 'star':
                    case 'unstar':
                        $change['is_starred'] = $action === 'star';
                        break;
                }
                DB::table('mail_messages')->where('id', $message->id)->update($change);
                $count++;
            }
            return $count;
        });

        $labels = [
            'trash' => 'Moved to Trash.',
            'restore' => 'Restored to the original folder.',
            'archive' => 'Archived.',
            'read' => 'Marked as read.',
            'unread' => 'Marked as unread.',
            'star' => 'Starred.',
            'unstar' => 'Unstarred.',
        ];

        return response()->json(['message' => $labels[$action], 'updated' => $updated])
            ->header('Cache-Control', 'no-store');
    }
}
