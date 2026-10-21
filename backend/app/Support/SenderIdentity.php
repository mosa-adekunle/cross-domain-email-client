<?php

namespace App\Support;

use ZBateson\MailMimeParser\Header\AddressHeader;
use ZBateson\MailMimeParser\Message;

final class SenderIdentity
{
    /**
     * Returns the sender email and optional RFC 5322 display name.
     * Email headers are untrusted; rely on the MIME parser for address/encoded-word
     * decoding and return a plain-text, bounded name.
     */
    public static function fromMessage(Message $message, string $fallbackAddress = ''): array
    {
        $header = $message->getHeader('From');
        $address = $header instanceof AddressHeader
            ? (string) ($header->getEmail() ?? '')
            : (string) ($message->getHeaderValue('From') ?? '');
        $address = trim($address);
        if (! filter_var($address, FILTER_VALIDATE_EMAIL)) {
            $address = trim($fallbackAddress);
        }
        if (! filter_var($address, FILTER_VALIDATE_EMAIL)) {
            $address = '';
        }
        $name = $header instanceof AddressHeader ? (string) ($header->getPersonName() ?? '') : '';
        $name = trim(preg_replace('/[\x00-\x1f\x7f]/u', ' ', $name) ?? '');
        if ($name === '' || strcasecmp($name, $address) === 0) {
            $name = null;
        } else {
            $name = mb_substr($name, 0, 150, 'UTF-8');
        }
        return ['email' => mb_substr($address, 0, 320), 'name' => $name];
    }
}
