<?php

namespace App\Support;

use ZBateson\MailMimeParser\IMessage;

final class ArchivedMimeAttachments
{
    public const MAX_ATTACHMENTS = 100;

    public const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

    // Only explicitly safe, commonly viewed formats are eligible for previews.
    private const VIEWABLE_TYPES = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 'text/plain', 'text/csv', 'application/json',
    ];

    public static function parts(IMessage $message): array
    {
        return array_slice(array_values($message->getAllAttachmentParts()), 0, self::MAX_ATTACHMENTS);
    }

    public static function listing(IMessage $message): array
    {
        $list = [];
        foreach (self::parts($message) as $index => $part) {
            $mime = strtolower(trim((string) $part->getContentType()));
            $stream = $part->getBinaryContentStream();
            $size = $stream?->getSize();
            $list[] = [
                'index' => $index,
                'filename' => self::filename((string) ($part->getFilename() ?? ''), $index),
                'content_type' => $mime ?: 'application/octet-stream',
                'size_bytes' => $size !== null && $size >= 0 ? $size : null,
                'is_inline' => strtolower((string) $part->getContentDisposition()) === 'inline',
                'can_preview' => in_array($mime, self::VIEWABLE_TYPES, true),
            ];
        }
        return $list;
    }

    public static function filename(string $name, int $index): string
    {
        // Untrusted MIME filenames must never become paths, headers or controls.
        $name = str_replace(['\\', '/'], '_', $name);
        $name = preg_replace('/[\x00-\x1F\x7F]/', '', $name) ?? '';
        $name = preg_replace('/[\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $name) ?? '';
        $name = trim($name, " .\t");
        return mb_substr($name !== '' ? $name : 'attachment-'.($index + 1), 0, 180, 'UTF-8');
    }

    public static function asciiFilename(string $filename): string
    {
        $plain = preg_replace('/[^A-Za-z0-9._() -]/', '_', $filename) ?? '';
        $plain = trim($plain, ' .');
        return $plain !== '' ? $plain : 'attachment';
    }

    public static function decodedBytes(object $part): string
    {
        // getBinaryContentStream decodes MIME transfer encoding (e.g. base64)
        // without character set conversion, preserving PDF/image/ZIP bytes.
        $stream = $part->getBinaryContentStream();
        if ($stream === null) return '';
        if ($stream->isSeekable()) $stream->rewind();
        $bytes = '';
        while (! $stream->eof()) {
            $chunk = $stream->read(262144);
            if ($chunk === '') break;
            $bytes .= $chunk;
            if (strlen($bytes) > self::MAX_ATTACHMENT_BYTES) {
                throw new \RuntimeException('Attachment exceeds the permitted download size.');
            }
        }
        return $bytes;
    }

    public static function previewMime(string $declaredMime, string $bytes): ?string
    {
        $mime = strtolower(trim($declaredMime));
        if (! in_array($mime, self::VIEWABLE_TYPES, true)) return null;

        if (str_starts_with($mime, 'image/')) {
            $information = @getimagesizefromstring($bytes);
            $expected = [
                'image/jpeg' => IMAGETYPE_JPEG, 'image/png' => IMAGETYPE_PNG,
                'image/gif' => IMAGETYPE_GIF, 'image/webp' => IMAGETYPE_WEBP,
            ];
            return $information !== false && $information[2] === $expected[$mime] ? $mime : null;
        }

        if ($mime === 'application/pdf') {
            return str_starts_with($bytes, '%PDF-') ? $mime : null;
        }

        // The React viewer always renders text as textContent, never as HTML.
        return strlen($bytes) <= 1024 * 1024 && mb_check_encoding($bytes, 'UTF-8') ? 'text/plain; charset=utf-8' : null;
    }
}
