<?php

use Illuminate\Support\Str;

return [
    'driver' => env('SESSION_DRIVER', 'database'),
    'lifetime' => (int) env('SESSION_LIFETIME', 120),
    'expire_on_close' => false,
    'encrypt' => true,
    'files' => storage_path('framework/sessions'),
    'connection' => env('SESSION_CONNECTION', 'pgsql'),
    'table' => env('SESSION_TABLE', 'sessions'),
    'store' => env('SESSION_STORE'),
    'lottery' => [2, 100],
    'cookie' => env('SESSION_COOKIE', Str::slug(env('APP_NAME', 'cdec'), '_').'_session'),
    'path' => '/',
    'domain' => env('SESSION_DOMAIN'),
    // Localhost SSH-tunnel preview only. Switch to true before public HTTPS.
    'secure' => filter_var(env('SESSION_SECURE_COOKIE', false), FILTER_VALIDATE_BOOL),
    'http_only' => true,
    'same_site' => 'strict',
    'partitioned' => false,
];
