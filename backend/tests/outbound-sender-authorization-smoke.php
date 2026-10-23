<?php

require dirname(__DIR__).'/vendor/autoload.php';

use App\Support\OutboundSenderAuthorization as Authorization;

function checkOutboundSender(bool $actual, bool $expected, string $label): void
{
    if ($actual !== $expected) {
        throw new RuntimeException('Sender authorization failed: '.$label);
    }
}

checkOutboundSender(Authorization::allowed(null, 'support'), true, 'legacy production sender without settings');
checkOutboundSender(Authorization::allowed('{}', 'support'), true, 'legacy sender with empty settings');
checkOutboundSender(Authorization::allowed('{"onboarding_pending":true}', 'sales'), false, 'new pending mailbox cannot send');
checkOutboundSender(Authorization::allowed('{"onboarding_pending":true,"outbound_enabled":true}', 'sales'), true, 'verified outbound independently of inbound onboarding');
checkOutboundSender(Authorization::allowed('{"onboarding_pending":false,"outbound_enabled":false}', 'sales'), false, 'explicit revocation overrides old allowance');
checkOutboundSender(Authorization::allowed('{"outbound_enabled":"true"}', 'sales'), false, 'string cannot spoof boolean authorization');
checkOutboundSender(Authorization::allowed('invalid json', 'sales'), false, 'invalid settings fail closed');
checkOutboundSender(Authorization::allowed('{"catchall":true,"outbound_enabled":true}', 'catchall'), false, 'catch-all never sends');
checkOutboundSender(Authorization::allowed('{"catchall":true,"outbound_enabled":true}', 'somethingelse'), false, 'catch-all flag never sends');
checkOutboundSender(Authorization::allowed(null, 'catchall'), false, 'catch-all local part never sends');
checkOutboundSender(Authorization::allowed('{"onboarding_pending":true,"outbound_enabled":true}', 'billing'), true, 'any specifically approved named address may send');
checkOutboundSender(Authorization::allowed('{"onboarding_pending":true,"outbound_enabled":false}', 'billing'), false, 'unapproved specific mailbox cannot send');

$command = new App\Console\Commands\AuthorizeOutboundMailboxes();
checkOutboundSender($command->getDefinition()->hasOption('address'), true, 'individual mailbox CLI option is registered');

echo "Outbound sender authorization smoke tests passed.\n";
