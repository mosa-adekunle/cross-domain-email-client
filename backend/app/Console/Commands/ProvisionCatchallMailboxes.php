<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

class ProvisionCatchallMailboxes extends Command
{
    protected $signature = 'mail:provision-catchalls {--apply : Add missing domain inboxes (default is preview)}';
    protected $description = 'Create one pending catch-all inbox for each approved owned domain';

    public function handle(): int
    {
        $domains = config('catchall_domains', []);
        if ($domains !== [
            'receiptboss.ca', 'santasbag.ca', 'madenorth.dev',
            'madekunle.com', 'delishearsentertainment.com',
        ]) {
            $this->error('Unexpected catch-all domain inventory.');
            return self::FAILURE;
        }

        $apply = (bool) $this->option('apply');
        $newDomains = 0;
        $newMailboxes = 0;

        try {
            DB::transaction(function () use ($domains, $apply, &$newDomains, &$newMailboxes): void {
                foreach ($domains as $name) {
                    $domain = DB::table('mail_domains')->where('domain_name', $name)->first();
                    if (! $domain) {
                        $newDomains++;
                        if ($apply) {
                            $id = DB::table('mail_domains')->insertGetId([
                                'domain_name' => $name,
                                'verification_status' => 'pending',
                                'is_active' => false,
                                'created_at' => now(),
                                'updated_at' => now(),
                            ]);
                            $domain = (object) ['id' => $id];
                        }
                    }
                    $address = 'catchall@'.$name;
                    $existing = DB::table('mailboxes')->where('address', $address)->first();
                    if ($existing) {
                        if ($domain && (int) $existing->mail_domain_id !== (int) $domain->id) {
                            throw new \RuntimeException('Existing catch-all belongs to a different domain.');
                        }
                        $this->line('Existing (unchanged): '.$address);
                        continue;
                    }
                    $newMailboxes++;
                    $this->line(($apply ? 'Creating: ' : 'Would create: ').$address);
                    if ($apply) {
                        if (! $domain) throw new \RuntimeException('Missing domain.');
                        DB::table('mailboxes')->insert([
                            'mail_domain_id' => $domain->id,
                            'local_part' => 'catchall',
                            'address' => $address,
                            'display_name' => 'Other mail · '.$name,
                            'is_active' => false,
                            'settings' => json_encode([
                                'catchall' => true,
                                'onboarding_pending' => true,
                            ], JSON_THROW_ON_ERROR),
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    }
                }
            });
        } catch (Throwable $error) {
            $this->error('No partial changes: '.get_class($error));
            return self::FAILURE;
        }

        $this->info(sprintf('%s: %d domain(s), %d catch-all mailbox(es).',
            $apply ? 'Created' : 'Preview new', $newDomains, $newMailboxes));
        $this->line('No Cloudflare DNS, Email Routing, SMTP or existing mailbox was changed.');
        return self::SUCCESS;
    }
}
