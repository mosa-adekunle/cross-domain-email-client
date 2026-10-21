<?php

require dirname(__DIR__).'/vendor/autoload.php';

use App\Support\OutboundMessageData as Data;

function check(bool $value, string $label): void
{
    if (! $value) throw new RuntimeException('Outbound test failed: '.$label);
}

$normalized = Data::normalize([
    'mailbox_id' => 2,
    'to' => ['User@example.com', 'user@example.com', 'two@example.com'],
    'cc' => ['user@example.com', 'three@example.com'],
    'bcc' => ['three@example.com', 'secret@example.com'],
    'subject' => ' Example subject ',
    'body_text' => "Hello\nWorld",
    'in_reply_to' => '<abc@example.com>',
]);
check($normalized['mailbox_id'] === 2, 'sender mailbox ID');
check($normalized['to'] === ['User@example.com', 'two@example.com'], 'To deduplication');
check($normalized['cc'] === ['three@example.com'], 'no duplicate between To and Cc');
check($normalized['bcc'] === ['secret@example.com'], 'no duplicate between Cc and Bcc');
check($normalized['subject'] === 'Example subject', 'subject normalization');
check($normalized['body_text'] === "Hello\nWorld", 'body bytes preserved');
check($normalized['in_reply_to'] === '<abc@example.com>', 'valid threading header');
check(Data::singleMessageId("<x@y.net>\r\nBcc:bad@example.org") === null, 'header injection blocked');
check(Data::singleMessageId('random text') === null, 'invalid message-id blocked');
check(Data::singleMessageId('yahoo-message-id.123@mailer.yahoo.com') === '<yahoo-message-id.123@mailer.yahoo.com>', 'bare incoming Message-ID normalized for reply');
check(Data::normalize([
    'mailbox_id' => 2, 'to' => ['recipient@example.com'], 'subject' => 'Re: test',
    'body_text' => 'Reply body', 'in_reply_to' => 'yahoo-message-id.123@mailer.yahoo.com',
])['in_reply_to'] === '<yahoo-message-id.123@mailer.yahoo.com>', 'draft accepts canonicalized reply ID');
check(Data::singleMessageId('<already@bracketed.example>') === '<already@bracketed.example>', 'already-bracketed Message-ID preserved');
check(Data::singleMessageId('one@example.com two@example.com') === null, 'multiple bare IDs rejected');
check(Data::singleMessageId("bare@example.org\r\nBcc:other@example.org") === null, 'bare ID header injection rejected');
check(Data::singleMessageId("<bare@example.org>\r\n") === null, 'trailing CRLF rejected');
check(Data::singleMessageId(str_repeat('a', 995).'@x') === null, 'overlong unbracketed ID rejected');
check(Data::singleMessageId('') === null, 'missing message-id allowed');
check(Data::addresses(['a@example.org', ' A@example.org ', '', 'b@example.org']) === ['a@example.org', 'b@example.org'], 'recipient normalization');

echo "Outbound mail data validation smoke tests passed.\n";
