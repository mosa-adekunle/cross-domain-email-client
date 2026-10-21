<?php

require dirname(__DIR__).'/vendor/autoload.php';

use App\Support\SenderIdentity;
use ZBateson\MailMimeParser\Message;

function assertSender(bool $condition, string $label): void
{
    if (! $condition) throw new RuntimeException('Sender identity test failed: '.$label);
}

function parsed(string $from): Message
{
    return Message::from("From: ".$from."\r\nSubject: Test\r\n\r\nBody", false);
}

$named = SenderIdentity::fromMessage(parsed('"Mosa Adekunle" <mosa@example.com>'));
assertSender($named['name'] === 'Mosa Adekunle', 'display name is saved');
assertSender($named['email'] === 'mosa@example.com', 'only the address is stored as email');

$bare = SenderIdentity::fromMessage(parsed('anonymous@example.net'));
assertSender($bare['name'] === null, 'no fabricated name for bare email');
assertSender($bare['email'] === 'anonymous@example.net', 'bare email preserved');

$encoded = SenderIdentity::fromMessage(parsed('=?UTF-8?Q?Mosa_Adekunle?= <encoded@example.org>'));
assertSender($encoded['name'] === 'Mosa Adekunle', 'MIME encoded sender name decoded');

$missing = SenderIdentity::fromMessage(Message::from("Subject: Missing From\r\n\r\nBody", false), 'fallback@example.com');
assertSender($missing['email'] === 'fallback@example.com', 'envelope sender fallback');
assertSender($missing['name'] === null, 'no invented name from envelope');

$long = SenderIdentity::fromMessage(parsed('"'.str_repeat('N', 190).'" <long@example.com>'));
assertSender(mb_strlen($long['name'], 'UTF-8') === 150, 'display name length bounded');

echo "Sender identity smoke tests passed.\n";
