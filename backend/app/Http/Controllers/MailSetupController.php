<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class MailSetupController
{
    public function domains(): JsonResponse
    {
        $domains = DB::table('mail_domains as d')
            ->leftJoin('mailboxes as m', 'm.mail_domain_id', '=', 'd.id')
            ->select('d.id', 'd.domain_name', 'd.verification_status', 'd.is_active', 'd.verified_at', 'd.created_at')
            ->selectRaw('COUNT(m.id) AS mailbox_count')
            ->groupBy('d.id', 'd.domain_name', 'd.verification_status', 'd.is_active', 'd.verified_at', 'd.created_at')
            ->orderBy('d.domain_name')
            ->get();

        return response()->json(['domains' => $domains])->header('Cache-Control', 'no-store');
    }

    public function addDomain(Request $request): JsonResponse
    {
        $data = $request->validate(['domain_name' => ['required', 'string', 'max:253']]);
        $domain = $this->normalizeDomain($data['domain_name']);

        Validator::make(['domain_name' => $domain], [
            'domain_name' => ['required', Rule::unique('mail_domains', 'domain_name')],
        ])->validate();

        try {
            $id = DB::table('mail_domains')->insertGetId([
                'domain_name' => $domain,
                'verification_status' => 'pending',
                'is_active' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (QueryException $exception) {
            if ($exception->getCode() !== '23505') {
                throw $exception;
            }
            throw ValidationException::withMessages(['domain_name' => 'This domain is already configured.']);
        }

        return response()->json([
            'domain' => DB::table('mail_domains')->find($id),
            'message' => 'Domain saved in pending verification. Existing DNS and mail delivery are unchanged.',
        ], 201)->header('Cache-Control', 'no-store');
    }

    public function mailboxes(): JsonResponse
    {
        $mailboxes = DB::table('mailboxes as m')
            ->join('mail_domains as d', 'd.id', '=', 'm.mail_domain_id')
            ->select('m.id', 'm.mail_domain_id', 'm.local_part', 'm.address', 'm.display_name', 'm.is_active', 'm.created_at', 'd.domain_name', 'd.verification_status', 'd.is_active as domain_active')
            ->orderBy('m.address')
            ->get();

        return response()->json(['mailboxes' => $mailboxes])->header('Cache-Control', 'no-store');
    }

    public function addMailbox(Request $request): JsonResponse
    {
        $data = $request->validate([
            'mail_domain_id' => ['required', 'integer', Rule::exists('mail_domains', 'id')],
            'local_part' => ['required', 'string', 'max:64'],
            'display_name' => ['nullable', 'string', 'max:150'],
        ]);
        $local = strtolower(trim($data['local_part']));
        // Dot-atom local parts only for this first setup UI. Quoted addresses and
        // non-ASCII SMTPUTF8 local parts will require explicit support later.
        if (! preg_match("/^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*$/D", $local)) {
            throw ValidationException::withMessages(['local_part' => 'Enter a valid email name (for example, support or billing.team).']);
        }

        $domain = DB::table('mail_domains')->find($data['mail_domain_id']);
        $address = $local.'@'.$domain->domain_name;
        Validator::make(['address' => $address], [
            'address' => [Rule::unique('mailboxes', 'address')],
        ])->validate();

        try {
            $id = DB::table('mailboxes')->insertGetId([
                'mail_domain_id' => $domain->id,
                'local_part' => $local,
                'address' => $address,
                'display_name' => isset($data['display_name']) ? trim($data['display_name']) : null,
                // Do not activate until domain ownership and routing are verified.
                'is_active' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (QueryException $exception) {
            if ($exception->getCode() !== '23505') {
                throw $exception;
            }
            throw ValidationException::withMessages(['local_part' => 'This mailbox already exists.']);
        }

        return response()->json([
            'mailbox' => DB::table('mailboxes')->find($id),
            'message' => 'Mailbox saved as inactive until receiving and sending are configured.',
        ], 201)->header('Cache-Control', 'no-store');
    }

    private function normalizeDomain(string $input): string
    {
        $input = trim($input);
        if ($input === '' || str_contains($input, '@') || str_contains($input, '/') || str_contains($input, ':')) {
            throw ValidationException::withMessages(['domain_name' => 'Enter a domain name only, without a URL or email prefix.']);
        }

        $ascii = idn_to_ascii(rtrim($input, '.'), IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
        $domain = is_string($ascii) ? strtolower($ascii) : '';
        $labels = explode('.', $domain);
        if (strlen($domain) < 4 || strlen($domain) > 253 || count($labels) < 2) {
            throw ValidationException::withMessages(['domain_name' => 'Enter a valid public domain (for example, example.com).']);
        }
        foreach ($labels as $label) {
            if (strlen($label) > 63 || ! preg_match('/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/D', $label)) {
                throw ValidationException::withMessages(['domain_name' => 'The domain contains an invalid DNS label.']);
            }
        }
        $tld = end($labels);
        if (strlen($tld) < 2 || ctype_digit($tld)) {
            throw ValidationException::withMessages(['domain_name' => 'A valid public domain suffix is required.']);
        }
        return $domain;
    }
}
