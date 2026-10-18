<?php

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

// This endpoint reports infrastructure readiness only. It contains no mail data.
Route::get('/status', function (): JsonResponse {
    try {
        DB::select('SELECT 1');

        return response()->json([
            'service' => 'cross-domain-email-api',
            'status' => 'ready',
            'database' => 'connected',
        ]);
    } catch (Throwable $exception) {
        report($exception);

        return response()->json([
            'service' => 'cross-domain-email-api',
            'status' => 'unavailable',
            'database' => 'unavailable',
        ], 503);
    }
});
