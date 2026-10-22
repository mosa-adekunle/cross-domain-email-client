<?php

// Simple no-database contract test for approved multi-brand mailbox inventory.
$manifest = require dirname(__DIR__).'/config/brand_mailboxes.php';
$expected = [
    'receiptboss.ca' => ['sales', 'legal', 'privacy', 'hello'],
    'santasbag.ca' => ['sales', 'legal', 'privacy', 'hello'],
    'madenorth.dev' => ['mosa', 'hello', 'sales'],
];
if (array_keys($manifest) !== array_keys($expected)) {
    throw new RuntimeException('Unexpected managed domains.');
}
$all = [];
foreach ($expected as $domain => $locals) {
    if (array_keys($manifest[$domain]) !== $locals) {
        throw new RuntimeException('Unexpected approved mailboxes for '.$domain);
    }
    foreach ($manifest[$domain] as $local => $label) {
        if (! is_string($label) || trim($label) === '') {
            throw new RuntimeException('Missing display name.');
        }
        $all[] = $local.'@'.$domain;
    }
}
if (count($all) !== 11 || count(array_unique($all)) !== 11) {
    throw new RuntimeException('Expected eleven unique business mailboxes.');
}
echo "Multi-brand mailbox inventory smoke tests passed (11).\n";
