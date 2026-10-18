<?php

return [
    // R2 credentials are scoped server-side credentials only, never sent to
    // the browser or committed in Git. The Cloudflare Worker uses a binding.
    'account_id' => env('R2_ACCOUNT_ID', ''),
    'access_key_id' => env('R2_ACCESS_KEY_ID', ''),
    'secret_access_key' => env('R2_SECRET_ACCESS_KEY', ''),
    'bucket' => env('R2_BUCKET', ''),
    'prefix' => 'incoming/',
    'max_bytes' => 25 * 1024 * 1024,
];
