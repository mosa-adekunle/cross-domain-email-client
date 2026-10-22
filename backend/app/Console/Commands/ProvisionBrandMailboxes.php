<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * Safely stages only the explicitly approved identities.
 *
 * --apply creates missing domains and mailboxes in pending/inactive state.
 * Existing records, including active production mailboxes, remain unchanged.
 * This command never changes DNS, forwarding rules, Worker vars or SMTP.
 */
class ProvisionBrandMailboxes extends Command
{
    protected $signature = 'mail:provision-brand-mailboxes {--apply : Persist missing inactive mailboxes; otherwise preview only}';
    protected $description = 'Stage the eleven approved business email addresses without changing delivery or sending';

    public function handle(): int
    {
        $manifest = config('brand_mailboxes', []);
        if (! is_array($manifest) || count($manifest) !== 3) {
            $this->error('Expected exactly three approved mail domains.');
            return self::FAILURE;
        }
        $expected = [
            'receiptboss.ca' => ['sales', 'legal', 'privacy', 'hello'],
            'santasbag.ca' => ['sales', 'legal', 'privacy', 'hello'],
            'madenorth.dev' => ['mosa', 'hello', 'sales'],
        ];
        foreach ($expected as $domain => $names) {
            if (! isset($manifest[$domain]) || array_keys($manifest[$domain]) !== $names) {
                $this->error('Approved mailbox manifest is incomplete or unexpectedly changed.');
                return self::FAILURE;
            }
        }

        $apply = (bool) $this->option('apply');
        $createdDomains = 0;
        $createdMailboxes = 0;
        $existingMailboxes = 0;
        try {
            // A single transaction avoids partially onboarding one domain.
            DB::transaction(function () use ($manifest, $apply, &$createdDomains, &$createdMailboxes, &$existingMailboxes): void {
                foreach ($manifest as $domainName => $entries) {
                    $domain = DB::table('mail_domains')->where('domain_name', $domainName)->first();
                    if (! $domain) {
                        $createdDomains++;
                        if ($apply) {
                            $id = DB::table('mail_domains')->insertGetId([
                                'domain_name' => $domainName,
                                'verification_status' => 'pending',
                                'is_active' => false,
                                'created_at' => now(),
                                'updated_at' => now(),
                            ]);
                            $domain = (object) ['id' => $id];
                        }
                    }
                    foreach ($entries as $local => $name) {
                        $address = $local.'@'.$domainName;
                        $existing = DB::table('mailboxes')->where('address', $address)->first();
                        if ($existing) {
                            if ($domain && (int) $existing->mail_domain_id !== (int) $domain->id) {
                                throw new RuntimeException('Existing address belongs to an unexpected domain.');
                            }
                            $existingMailboxes++;
                            $this->line('Existing (unchanged): '.$address);
                            continue;
                        }
                        $createdMailboxes++;
                        $this->line(($apply ? 'Staging: ' : 'Would stage: ').$address);
                        if ($apply) {
                            if (! $domain) throw new RuntimeException('Missing domain for mailbox staging.');
                            DB::table('mailboxes')->insert([
                                'mail_domain_id' => $domain->id,
                                'local_part' => $local,
                                'address' => $address,
                                'display_name' => $name,
                                'is_active' => false,
                                'settings' => json_encode(['onboarding_pending' => true], JSON_THROW_ON_ERROR),
                                'created_at' => now(),
                                'updated_at' => now(),
                            ]);
                        }
                    }
                }
            });
        } catch (Throwable $error) {
            $this->error('Provisioning aborted with no partial changes: '.get_class($error));
            return self::FAILURE;
        }

        $this->info(sprintf(
            '%s: %d domain(s) %s, %d mailbox(es) %s, %d existing mailbox(es) unchanged.',
            $apply ? 'Provisioned' : 'Preview',
            $createdDomains,
            $apply ? 'created' : 'to create',
            $createdMailboxes,
            $apply ? 'staged inactive' : 'to stage',
            $existingMailboxes
        ));
        $this->line('Mail routing, DNS and outgoing SMTP remain unchanged.');
        return self::SUCCESS;
    }
}
