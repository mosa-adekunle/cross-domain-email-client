<?php

namespace App\Support;

use Illuminate\Validation\ValidationException;

final class OutboundMessageData
{
    public static function normalize(array $input): array
    {
        $to = self::addresses($input['to'] ?? []);
        $cc = self::addresses($input['cc'] ?? []);
        $bcc = self::addresses($input['bcc'] ?? []);
        $seen = [];
        foreach ([$to, $cc, $bcc] as $index => $list) {
            $deduped = [];
            foreach ($list as $address) {
                $key = strtolower($address);
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $deduped[] = $address;
            }
            if ($index === 0) $to = $deduped;
            if ($index === 1) $cc = $deduped;
            if ($index === 2) $bcc = $deduped;
        }
        return [
            'mailbox_id' => (int) $input['mailbox_id'],
            'to' => $to,
            'cc' => $cc,
            'bcc' => $bcc,
            'subject' => trim((string) ($input['subject'] ?? '')),
            'body_text' => (string) ($input['body_text'] ?? ''),
            'in_reply_to' => self::singleMessageId((string) ($input['in_reply_to'] ?? '')),
        ];
    }

    public static function addresses(array $list): array
    {
        $out = [];
        foreach ($list as $raw) {
            if (! is_string($raw)) continue;
            $address = trim($raw);
            if ($address !== '') $out[strtolower($address)] = $address;
        }
        return array_values($out);
    }

    public static function validateReady(array $data): void
    {
        $to = self::addresses($data['to']);
        $cc = self::addresses($data['cc']);
        $bcc = self::addresses($data['bcc']);
        if (count($to) === 0) {
            throw ValidationException::withMessages(['to' => 'At least one To recipient is required.']);
        }
        if (count($to) + count($cc) + count($bcc) > (int) config('outbound.max_recipients', 30)) {
            throw ValidationException::withMessages(['to' => 'Too many recipients for one email.']);
        }
        if (trim((string) $data['body_text']) === '' && trim((string) $data['subject']) === '') {
            throw ValidationException::withMessages(['body_text' => 'Write a subject or message before sending.']);
        }
    }

    public static function singleMessageId(string $value): ?string
    {
        $id = trim($value);
        if ($id === '' || strlen($id) > 998 || preg_match('/[\r\n\x00-\x1f]/', $id)) return null;
        return preg_match('/^<[^<>\s@]+@[^<>\s@]+>$/D', $id) ? $id : null;
    }

    public static function configured(): bool
    {
        return config('mail.default') === 'smtp'
            && (string) config('mail.mailers.smtp.host') !== ''
            && (int) config('mail.mailers.smtp.port') > 0
            && (string) config('mail.mailers.smtp.username') !== ''
            && (string) config('mail.mailers.smtp.password') !== ''
            && count(config('outbound.allowed_domains', [])) > 0;
    }

    public static function domainAllowed(string $address): bool
    {
        $at = strrpos($address, '@');
        if ($at === false) return false;
        return in_array(strtolower(substr($address, $at + 1)), config('outbound.allowed_domains', []), true);
    }
}
