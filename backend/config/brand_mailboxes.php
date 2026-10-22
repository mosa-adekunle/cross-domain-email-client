<?php

// Explicit, user-approved mailbox inventory. This file contains no secrets
// and does not configure DNS, Cloudflare Email Routing, MX or SMTP credentials.
// The existing inbox-test@receiptboss.ca pilot must remain untouched.
return [
    'receiptboss.ca' => [
        'sales' => 'ReceiptBoss Sales',
        'legal' => 'ReceiptBoss Legal',
        'privacy' => 'ReceiptBoss Privacy',
        'hello' => 'ReceiptBoss',
    ],
    'santasbag.ca' => [
        'sales' => "Santa's Bag Sales",
        'legal' => "Santa's Bag Legal",
        'privacy' => "Santa's Bag Privacy",
        'hello' => "Santa's Bag",
    ],
    'madenorth.dev' => [
        'mosa' => 'Mosa',
        'hello' => 'Made North Technologies',
        'sales' => 'Made North Technologies Sales',
    ],
];
