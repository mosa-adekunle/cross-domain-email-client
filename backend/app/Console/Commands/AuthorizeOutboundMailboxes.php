<?php

namespace App\Console\Commands;

use App\Support\OutboundMessageData;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * Explicitly authorize existing named mailboxes for SMTP without enabling
 * inbound routing, changing DNS, or touching catch-all mailboxes.
 *
 * Resend verification is checked by the operator outside this command. Only
 * the two provider-verified domains are eligible as of October 23, 2026.
 * --address authorizes one existing named mailbox without editing the fixed
 * inventory used for bulk approval.
 */
final class AuthorizeOutboundMailboxes extends Command
{
    protected $signature = 'mail:authorize-outbound {--domain= : One approved verified domain; default both} {--address= : One existing named sender mailbox on a verified domain} {--apply : Persist sender authorization; default preview}';

    protected $description = 'Authorize approved named or individual existing mailboxes for Resend outbound sending';

    private const VERIFIED_SENDER_DOMAINS = ['receiptboss.ca', 'santasbag.ca'];

    public function handle(): int
    {
        $requested = strtolower(trim((string) $this->option('domain')));
        $address = strtolower(trim((string) $this->option('address')));
        if ($requested !== '' && $address !== '') {
            $this->error('Choose either --domain or --address, not both.');
            return self::FAILURE;
        }
        if ($address !== '' && (! filter_var($address, FILTER_VALIDATE_EMAIL) || substr_count($address, '@') !== 1)) {
            $this->error('Enter one valid existing mailbox address with --address.');
            return self::FAILURE;
        }

        $specificLocal = '';
        if ($address !== '') {
            [$specificLocal, $requested] = explode('@', $address, 2);
            if ($specificLocal === 'catchall') {
                $this->error('Catch-all receiving inboxes cannot send email.');
                return self::FAILURE;
            }
        }
        if ($requested !== '' && ! in_array($requested, self::VERIFIED_SENDER_DOMAINS, true)) {
            $this->error('Domain is not approved for outgoing mail. Verify it in Resend before changing the eligible-domain list.');
            return self::FAILURE;
        }

        $manifest = config('brand_mailboxes', []);
        $expected = [
            'receiptboss.ca' => ['sales', 'legal', 'privacy', 'hello'],
            'santasbag.ca' => ['sales', 'legal', 'privacy', 'hello'],
        ];
        if ($address === '') {
            foreach ($expected as $domain => $addresses) {
                if (! isset($manifest[$domain]) || array_keys($manifest[$domain]) !== $addresses) {
                    $this->error('The approved named-mailbox inventory has changed unexpectedly.');
                    return self::FAILURE;
                }
            }
        }

        $domains = $requested !== '' ? [$requested] : self::VERIFIED_SENDER_DOMAINS;
        $apply = (bool) $this->option('apply');
        if ($apply) {
            if (! OutboundMessageData::configured()
                || strcasecmp((string) config('mail.mailers.smtp.host'), 'smtp.resend.com') !== 0
                || strcasecmp((string) config('mail.mailers.smtp.username'), 'resend') !== 0) {
                $this->error('Resend SMTP is not configured. No sender authorization changed.');
                return self::FAILURE;
            }
            foreach ($domains as $domain) {
                if (! in_array($domain, config('outbound.allowed_domains', []), true)) {
                    $this->error('Add '.$domain.' to OUTBOUND_ALLOWED_DOMAINS on the server first. No changes made.');
                    return self::FAILURE;
                }
            }
        }

        $updated = 0;
        $already = 0;
        try {
            // Fail and roll back as one unit if any named mailbox was not
            // provisioned yet. All existing routing and mailbox flags survive.
            DB::transaction(function () use ($domains, $manifest, $apply, $address, $specificLocal, &$updated, &$already): void {
                foreach ($domains as $domainName) {
                    $domain = DB::table('mail_domains')->where('domain_name', $domainName)->first();
                    if (! $domain) {
                        throw new RuntimeException('Domain not yet provisioned: '.$domainName);
                    }
                    // Explicit single-mailbox mode can approve a new named address.
                    // Bulk mode remains restricted to the established inventory.
                    $entries = $address !== '' ? [$specificLocal => null] : $manifest[$domainName];
                    foreach ($entries as $local => $displayName) {
                        $address = $local.'@'.$domainName;
                        $mailbox = DB::table('mailboxes')->where('address', $address)->lockForUpdate()->first();
                        if (! $mailbox || (int) $mailbox->mail_domain_id !== (int) $domain->id) {
                            throw new RuntimeException('Named mailbox not yet provisioned: '.$address);
                        }
                        $settings = json_decode((string) ($mailbox->settings ?? '{}'), true);
                        if (strtolower((string) $mailbox->local_part) === 'catchall'
                            || ! is_array($settings) || ($settings['catchall'] ?? false) === true) {
                            throw new RuntimeException('Unsafe mailbox settings for: '.$address);
                        }
                        if (($settings['outbound_enabled'] ?? null) === true) {
                            $already++;
                            $this->line('Already authorized: '.$address);
                            continue;
                        }
                        $updated++;
                        $this->line(($apply ? 'Authorizing: ' : 'Would authorize: ').$address);
                        if ($apply) {
                            // Keep onboarding_pending and is_active unchanged:
                            // inbound receipt/forwarding is a separate workflow.
                            $settings['outbound_enabled'] = true;
                            DB::table('mailboxes')->where('id', $mailbox->id)->update([
                                'settings' => json_encode($settings, JSON_THROW_ON_ERROR),
                                'updated_at' => now(),
                            ]);
                        }
                    }
                }
            });
        } catch (Throwable $exception) {
            $this->error('Authorization aborted with no partial changes: '.$exception->getMessage());
            return self::FAILURE;
        }

        $this->info(($apply ? 'Authorized ' : 'Preview: ').$updated.' named address(es); '.$already.' already authorized.');
        $this->line('Cloudflare routing, inbound onboarding flags, existing forwarding, catch-all inboxes and SMTP credentials were not modified.');
        if (! $apply) {
            $this->line('After verifying Resend domain status and server SMTP configuration, repeat with --apply.');
        }
        return self::SUCCESS;
    }
}
