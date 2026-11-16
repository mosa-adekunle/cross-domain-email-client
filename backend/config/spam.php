<?php

return [
    // No messages are deleted. Classification only chooses Inbox or Spam.
    'enabled' => env('MAIL_SPAM_FILTER_ENABLED', true),
    'quarantine_score' => (int) env('MAIL_SPAM_QUARANTINE_SCORE', 60),
    // Authentication-Results headers are forgeable unless injected by a
    // verified ingress. Empty by default: do NOT trust arbitrary MIME headers.
    'trusted_authserv_id' => env('MAIL_TRUSTED_AUTHSERV_ID', ''),
    // Still preserve unknown-recipient MIME in R2. Do not create inbox entries.
    'strict_recipient_domains' => array_values(array_filter(array_map(
        'trim', explode(',', strtolower((string) env('MAIL_STRICT_RECIPIENT_DOMAINS', 'madenorth.dev')))
    ))),
];
