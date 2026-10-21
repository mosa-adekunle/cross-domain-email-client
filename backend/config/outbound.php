<?php

return [
    // Sending is deliberately disabled until a verified domain and SMTP
    // credentials are explicitly configured on the application EC2 host.
    'allowed_domains' => array_values(array_filter(array_map(
        static fn ($domain) => strtolower(trim($domain)),
        explode(',', (string) env('OUTBOUND_ALLOWED_DOMAINS', ''))
    ))),
    'max_recipients' => 30,
    'max_body_bytes' => 262144,
    'provider_label' => env('OUTBOUND_PROVIDER_LABEL', 'smtp'),
];
