<?php

use App\Http\Controllers\AuthController;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

// Infrastructure status contains no user, mailbox, or message data.
Route::get('/status', function (): JsonResponse {
    try {
        DB::select('SELECT 1');
        return response()->json(['service' => 'cross-domain-email-api', 'status' => 'ready', 'database' => 'connected']);
    } catch (Throwable $exception) {
        report($exception);
        return response()->json(['service' => 'cross-domain-email-api', 'status' => 'unavailable', 'database' => 'unavailable'], 503);
    }
});

// API routes are same-origin browser calls; Laravel's 'web' group enables
// database sessions, encrypted cookies, and CSRF checks on mutations.
Route::middleware('web')->group(function (): void {
    Route::get('/auth/csrf', [AuthController::class, 'csrf']);
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

    Route::middleware('auth:web')->group(function (): void {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/mailboxes', function (): JsonResponse {
            // Read-only until mailbox setup and ownership rules are implemented.
            return response()->json([
                'mailboxes' => DB::table('mailboxes')
                    ->select('id', 'address', 'display_name', 'is_active')
                    ->orderBy('address')
                    ->get(),
            ])->header('Cache-Control', 'no-store');
        });
    });
});
