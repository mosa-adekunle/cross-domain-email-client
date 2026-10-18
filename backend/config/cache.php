<?php

return [
    'default' => env('CACHE_STORE', 'database'),
    'stores' => [
        'database' => [
            'driver' => 'database',
            'connection' => env('DB_CONNECTION', 'pgsql'),
            'table' => 'cache',
            'lock_connection' => env('DB_CONNECTION', 'pgsql'),
            'lock_table' => 'cache_locks',
        ],
        'array' => ['driver' => 'array', 'serialize' => false],
        'file' => ['driver' => 'file', 'path' => storage_path('framework/cache/data')],
    ],
    'prefix' => env('CACHE_PREFIX', 'cdec_cache_'),
];
