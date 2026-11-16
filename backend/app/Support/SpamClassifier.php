<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

final class SpamClassifier
{
    public static function classify(string $sender, string $subject, string $plain, string $authenticationResults = ''): array
    {
        $sender = strtolower(trim($sender));
        $domain = str_contains($sender, '@') ? substr(strrchr($sender, '@'), 1) : '';
        $rule = DB::table('mail_sender_rules')
            ->where(function ($query) use ($sender, $domain): void {
                $query->where(function ($item) use ($sender): void {
                    $item->where('type', 'address')->where('value', $sender);
                })->orWhere(function ($item) use ($domain): void {
                    $item->where('type', 'domain')->where('value', $domain);
                });
            })
            ->orderByRaw("CASE WHEN type = 'address' THEN 0 ELSE 1 END")
            ->first();
        if ($rule && $rule->action === 'allow') {
            return ['spam' => false, 'score' => 0, 'reasons' => ['Trusted sender']];
        }
        if ($rule && $rule->action === 'block') {
            return ['spam' => true, 'score' => 100, 'reasons' => ['Blocked sender']];
        }
        if (! config('spam.enabled', true)) {
            return ['spam' => false, 'score' => 0, 'reasons' => []];
        }

        [$score, $reasons] = self::contentIndicators($subject, $plain);
        $feedback = DB::table('mail_sender_feedback')->where('address', $sender)->first();
        if ($feedback) {
            $score += min(70, (int) $feedback->spam_count * 35);
            $score -= min(70, (int) $feedback->ham_count * 35);
            if ($feedback->spam_count > $feedback->ham_count) $reasons[] = 'Previously marked as spam';
        }

        // Only honor this when the trusted ingress ID has been explicitly
        // configured after verifying that it strips untrusted injected headers.
        $trusted = strtolower(trim((string) config('spam.trusted_authserv_id', '')));
        $auth = strtolower(trim($authenticationResults));
        if ($trusted !== '' && str_starts_with($auth, $trusted.';')) {
            if (preg_match('~\b(?:dmarc|dkim|spf)=(?:fail|permerror)\b~', $auth)) {
                $score += 20;
                $reasons[] = 'Authentication failure reported by trusted ingress';
            }
        }
        return [
            'spam' => $score >= (int) config('spam.quarantine_score', 60),
            'score' => max(0, $score),
            'reasons' => array_values(array_unique($reasons)),
        ];
    }
    /** Pure heuristic stage: testable without a database, no destructive action. */
    public static function contentIndicators(string $subject, string $plain): array
    {
        $score = 0;
        $reasons = [];
        $content = mb_strtolower(mb_substr($subject."\n".$plain, 0, 20000, 'UTF-8'), 'UTF-8');
        $checks = [
            ['~\b(?:kickbacks?|bribes?|illicit funds|stolen funds|money laundering)\b~iu', 45, 'Suspicious financial request'],
            ['~\b(?:million|billions?)\b.{0,90}\b(?:funds?|dollars?|usd|investment|contracts?)\b|(?:us\$|usd|\$)\s?[0-9,.]+\s?(?:million|billion)\b~iu', 20, 'Large unsolicited financial claim'],
            ['~\b(?:overseas bank account|transfer the funds|move the funds|secure the funds|funds abroad)\b~iu', 22, 'Funds-transfer language'],
            ['~\b(?:political party|election campaign|parliamentary|government contract)\b~iu', 12, 'Political influence claim'],
            ['~\b(?:retain|receive|keep)\s+[0-9]{1,2}\s?%|\bprofits?\s+(?:will be\s+)?shared\b~iu', 18, 'Unsolicited profit sharing'],
            ['~\b(?:confidential proposal|business proposal|investment proposal|business partner(?:ship)?)\b~iu', 8, 'Unsolicited proposal'],
            ['~\b(?:urgent reply|immediate response|reply immediately|secret transaction)\b~iu', 14, 'Pressure or secrecy'],
        ];
        foreach ($checks as [$regex, $points, $reason]) {
            if (preg_match($regex, $content)) {
                $score += $points;
                $reasons[] = $reason;
            }
        }
        return [$score, $reasons];
    }

}
