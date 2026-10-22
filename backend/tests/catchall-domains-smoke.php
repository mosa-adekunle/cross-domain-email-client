<?php

$domains = require dirname(__DIR__).'/config/catchall_domains.php';
$expected = [
    'receiptboss.ca', 'santasbag.ca', 'madenorth.dev',
    'madekunle.com', 'delishearsentertainment.com',
];
if ($domains !== $expected) {
    throw new RuntimeException('Unexpected catch-all domain allowlist.');
}
foreach ($domains as $domain) {
    if (! filter_var('catchall@'.$domain, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Invalid domain catch-all inbox address.');
    }
}
$importer = file_get_contents(dirname(__DIR__).'/app/Console/Commands/SyncR2Mail.php');
if (! str_contains($importer, "config('catchall_domains', [])") ||
    ! str_contains($importer, "'catchall@'.\$domain") ||
    ! str_contains($importer, "'address' => \$recipient")) {
    throw new RuntimeException('Importer must retain true original recipient and owned-domain fallback.');
}
echo "Owned-domain catch-all safety checks passed (5).\n";
