<?php
require __DIR__.'/../vendor/autoload.php';
use App\Support\WebsiteContactSignature as Signature;

$secret = str_repeat('s', 48);
$body = '{"id":"valid"}';
$time = '1792788000';
$sig = 'sha256='.hash_hmac('sha256', $time.'.'.$body, $secret);
$assert = static function (bool $ok, string $name): void { if (! $ok) throw new RuntimeException($name); };
$assert(Signature::verify($secret, $time, $sig, $body, 1792788000), 'signature verified');
$assert(!Signature::verify($secret, $time, $sig, $body.'x', 1792788000), 'tampering rejected');
$assert(!Signature::verify('short', $time, $sig, $body, 1792788000), 'short secret rejected');
$assert(!Signature::verify($secret, $time, $sig, $body, 1792789000), 'old signature rejected');
$assert(!Signature::verify($secret, 'bad', $sig, $body, 1792788000), 'timestamp rejected');
$assert(!Signature::verify($secret, $time, 'sha256=invalid', $body, 1792788000), 'bad signature rejected');
echo "Website contact HMAC safety checks passed.\n";
