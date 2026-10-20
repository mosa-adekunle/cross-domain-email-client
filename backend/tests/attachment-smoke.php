<?php

// Run from project backend/ with: php tests/attachment-smoke.php
require dirname(__DIR__).'/vendor/autoload.php';

use App\Support\ArchivedMimeAttachments as Attachments;
use ZBateson\MailMimeParser\Message;

function must(bool $condition, string $message): void
{
    if (! $condition) throw new RuntimeException('Attachment smoke test failed: '.$message);
}

$png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/mH0AAAAASUVORK5CYII=', true);
must($png !== false, 'PNG fixture decodes');

$raw = "From: source@example.com\r\n".
    "To: inbox@example.com\r\n".
    "Subject: Attachment smoke\r\n".
    "MIME-Version: 1.0\r\n".
    "Content-Type: multipart/mixed; boundary=\"test-boundary\"\r\n\r\n".
    "--test-boundary\r\n".
    "Content-Type: text/plain; charset=utf-8\r\n\r\nHello from the body\r\n".
    "--test-boundary\r\n".
    "Content-Type: text/plain; name=\"hello.txt\"\r\n".
    "Content-Disposition: attachment; filename=\"hello.txt\"\r\n".
    "Content-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode("Hello attachment\n"), 76, "\r\n").
    "--test-boundary\r\n".
    "Content-Type: image/png; name=\"picture.png\"\r\n".
    "Content-Disposition: attachment; filename=\"picture.png\"\r\n".
    "Content-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($png), 76, "\r\n").
    "--test-boundary\r\n".
    "Content-Type: text/html; name=\"danger.html\"\r\n".
    "Content-Disposition: attachment; filename=\"danger.html\"\r\n".
    "Content-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode('<script>alert(1)</script>'), 76, "\r\n").
    "--test-boundary--\r\n";

$message = Message::from($raw, false);
$files = Attachments::listing($message);
must(count($files) === 3, 'three attachment parts discovered');
must($files[0]['index'] === 0 && $files[0]['filename'] === 'hello.txt', 'text file metadata and deterministic index');
must($files[1]['filename'] === 'picture.png', 'PNG metadata');
must($files[2]['can_preview'] === false, 'HTML cannot be previewed');
$parts = Attachments::parts($message);
must(Attachments::decodedBytes($parts[0]) === "Hello attachment\n", 'base64 text decodes intact');
must(Attachments::decodedBytes($parts[1]) === $png, 'binary PNG decodes byte-for-byte');
must(Attachments::previewMime('image/png', $png) === 'image/png', 'valid PNG accepted');
must(Attachments::previewMime('image/png', '<svg onload=alert(1)>') === null, 'fake PNG rejected');
must(Attachments::previewMime('text/html', '<script>') === null, 'HTML never previewed');
must(Attachments::previewMime('application/pdf', '%PDF-1.6'."\n") === 'application/pdf', 'PDF signature validated');
must(Attachments::previewMime('application/pdf', '<html>evil</html>') === null, 'fake PDF rejected');
must(Attachments::previewMime('text/plain', "Hello\n") === 'text/plain; charset=utf-8', 'UTF-8 text preview');
must(Attachments::previewMime('text/plain', "\xff") === null, 'binary text rejected');
must(Attachments::filename("..\\malicious/\r\nabc.txt", 0) === '_malicious_abc.txt', 'filename path/control filtering');
must(Attachments::asciiFilename('a"b#c.pdf') === 'a_b_c.pdf', 'ASCII fallback sanitized');
echo "MIME attachment smoke checks passed.\n";
