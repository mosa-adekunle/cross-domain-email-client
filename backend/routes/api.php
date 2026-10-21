<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\MailSetupController;
use App\Http\Controllers\MessageListController;
use App\Http\Controllers\MessageDetailController;
use App\Http\Controllers\OutboundMailController;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

// No mailbox, account, or message data is included in this anonymous endpoint.
Route::get('/status', function (): JsonResponse {
    try {
        DB::select('SELECT 1');
        return response()->json(['service' => 'cross-domain-email-api', 'status' => 'ready', 'database' => 'connected']);
    } catch (Throwable $exception) {
        report($exception);
        return response()->json(['service' => 'cross-domain-email-api', 'status' => 'unavailable', 'database' => 'unavailable'], 503);
    }
});

// All mailbox data is restricted to the authenticated administrator session.
// The web middleware group applies cookies, database sessions and CSRF checks.
Route::middleware('web')->group(function (): void {
    Route::get('/auth/csrf', [AuthController::class, 'csrf']);
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

    Route::middleware('auth:web')->group(function (): void {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/domains', [MailSetupController::class, 'domains']);
        Route::post('/domains', [MailSetupController::class, 'addDomain'])->middleware('throttle:20,1');
        Route::get('/mailboxes', [MailSetupController::class, 'mailboxes']);
        Route::post('/mailboxes', [MailSetupController::class, 'addMailbox'])->middleware('throttle:20,1');
        Route::get('/outbound/status', [OutboundMailController::class, 'status']);
        Route::post('/drafts', [OutboundMailController::class, 'createDraft'])->middleware('throttle:60,1');
        Route::patch('/drafts/{id}', [OutboundMailController::class, 'updateDraft'])->whereNumber('id')->middleware('throttle:60,1');
        Route::delete('/drafts/{id}', [OutboundMailController::class, 'deleteDraft'])->whereNumber('id');
        Route::post('/drafts/{id}/send', [OutboundMailController::class, 'sendDraft'])->whereNumber('id')->middleware('throttle:10,1');
        Route::get('/messages/unread-count', [MessageListController::class, 'unreadCount']);
        Route::get('/messages', [MessageListController::class, 'index']);
        Route::get('/messages/{id}', [MessageDetailController::class, 'show'])->whereNumber('id');
        Route::get('/messages/{id}/attachments/{index}', [MessageDetailController::class, 'attachment'])->whereNumber('id')->whereNumber('index')->middleware('throttle:60,1');
        Route::patch('/messages/{id}/read', [MessageDetailController::class, 'markRead'])->whereNumber('id');
    });
});
