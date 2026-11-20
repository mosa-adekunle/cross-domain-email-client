<?php

require dirname(__DIR__).'/vendor/autoload.php';

use App\Support\ArchivedHtmlPreview;

function verifyHtml(bool $ok, string $label): void
{
    if (! $ok) throw new RuntimeException('HTML preview smoke failed: '.$label);
}

$html = '<!doctype html><html><head><style>'.
    '@import url(https://tracker.example/evil.css);'.
    '.headline {font:20px Arial;color:#345678}'.
    '</style><script>window.parent.hacked=true</script></head>'.
    '<body><table bgcolor="#eeeeee"><tr><td style="color:#345678" onclick="alert(1)">'.
    '<p class="headline">Welcome <a href="https://example.com/start" onclick="alert(2)">to AdSense</a></p>'.
    '<a href="javascript:alert(1)">unsafe</a>'.
    '<img alt="Remote logo" src="https://images.example/logo.png">'.
    '<img alt="Inline image" src="cid:logo@example.test">'.
    '<iframe src="https://evil.example/"></iframe>'.
    '</td></tr></table></body></html>';

$inline = ['logo@example.test' => 'data:image/png;base64,AAAA'];
$blocked = ArchivedHtmlPreview::render($html, $inline);
verifyHtml(str_contains($blocked, '.headline'), 'head styles preserved');
verifyHtml(str_contains($blocked, 'style="color:#345678"'), 'inline styles preserved');
verifyHtml(str_contains($blocked, 'bgcolor="#eeeeee"'), 'email table colors preserved');
verifyHtml(str_contains($blocked, 'href="https://example.com/start"'), 'safe links preserved');
verifyHtml(str_contains($blocked, 'target="_blank"'), 'links open outside the sandbox');
verifyHtml(! str_contains($blocked, 'window.parent.hacked'), 'sender script removed');
verifyHtml(str_contains($blocked, "data-mail-resize=\"1\""), 'only trusted resize script inserted');
verifyHtml(str_contains($blocked, ArchivedHtmlPreview::resizeScript()), 'trusted measurement script retained');
verifyHtml(! str_contains($blocked, 'onclick='), 'event handlers removed');
verifyHtml(! str_contains($blocked, 'javascript:'), 'unsafe URI removed');
verifyHtml(! str_contains($blocked, '<iframe'), 'nested iframe removed');
verifyHtml(! str_contains($blocked, '@import'), 'remote CSS imports removed');
verifyHtml(! str_contains($blocked, 'https://images.example/logo.png'), 'external image URL removed when blocked');
verifyHtml(str_contains($blocked, 'data:image/png;base64,AAAA'), 'CID image rewritten locally');

$allowed = ArchivedHtmlPreview::render($html, $inline, true);
verifyHtml(str_contains($allowed, 'src="https://images.example/logo.png"'), 'remote image loads only on request');

echo "Isolated HTML email preview smoke tests passed.\n";
