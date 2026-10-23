<?php

namespace App\Support;

/**
 * Outbound authorization is independent of Cloudflare inbound onboarding.
 *
 * Older mailboxes without an explicit outbound setting keep their legacy
 * behavior. Newly provisioned, pending mailboxes require a deliberate
 * outbound_enabled=true setting even while inbound onboarding stays pending.
 * An explicit false always revokes sending, including for legacy mailboxes.
 */
final class OutboundSenderAuthorization
{
    public static function allowed(?string $settings, ?string $localPart = null): bool
    {
        // Catch-all inboxes are receiving containers, never sender identities.
        if (strtolower((string) $localPart) === 'catchall') {
            return false;
        }

        if ($settings === null || trim($settings) === '') {
            return true;
        }

        $flags = json_decode($settings, true);
        if (! is_array($flags)) {
            return false;
        }

        if (($flags['catchall'] ?? false) === true) {
            return false;
        }

        if (array_key_exists('outbound_enabled', $flags)) {
            return $flags['outbound_enabled'] === true;
        }

        return ($flags['onboarding_pending'] ?? false) !== true;
    }
}
