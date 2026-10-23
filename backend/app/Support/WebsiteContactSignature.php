<?php

namespace App\Support;

final class WebsiteContactSignature
{
    public static function verify(string $secret, string $timestamp, string $signature, string $body, ?int $now = null): bool
    {
        if (strlen($secret) < 32 || ! preg_match('/^\\d{10}$/D', $timestamp) ||
            ! preg_match('/^sha256=[a-f0-9]{64}$/D', $signature) ||
            abs(($now ?? time()) - (int) $timestamp) > 300) {
            return false;
        }
        return hash_equals('sha256='.hash_hmac('sha256', $timestamp.'.'.$body, $secret), $signature);
    }
}
