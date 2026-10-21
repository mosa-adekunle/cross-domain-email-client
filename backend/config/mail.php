<?php

return [
    // The per-message From address is always an existing configured mailbox
    // whose domain has been explicitly authorized for SMTP sending.
    'default' => env('MAIL_MAILER', 'smtp'),
    'mailers' => [
        'smtp' => [
            'transport' => 'smtp',
            'scheme' => env('MAIL_SCHEME', 'smtp'),
            'host' => env('MAIL_HOST', ''),
            'port' => (int) env('MAIL_PORT', 587),
            'username' => env('MAIL_USERNAME', ''),
            'password' => env('MAIL_PASSWORD', ''),
            'timeout' => 20,
        ],
        'log' => ['transport' => 'log', 'channel' => 'stderr'],
    ],
    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', 'no-reply@example.invalid'),
        'name' => env('MAIL_FROM_NAME', 'Cross Domain Email Client'),
    ],
];
