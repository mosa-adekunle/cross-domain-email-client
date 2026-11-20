<?php

namespace App\Support;

use DOMDocument;
use DOMElement;
use DOMNode;

final class ArchivedHtmlPreview
{
    // This is the only JavaScript permitted in the HTML preview.
    // It reports the document's natural height; it does not inspect message
    // contents, fetch resources, or change the top-level application.
    public static function resizeScript(): string
    {
        return "(function(){function report(){var b=document.body,d=document.documentElement;".
            "if(!b||!d)return;var h=Math.max(b.scrollHeight,b.offsetHeight,d.scrollHeight,d.offsetHeight);".
            "parent.postMessage({type:'madenorth-email-height',height:Math.ceil(h)},'*');}".
            "if(window.ResizeObserver){new ResizeObserver(report).observe(document.body);}".
            "window.addEventListener('load',report);report();})();";
    }

    /**
     * Render external email HTML as an inert, separately sandboxed document.
     * The HTTP response supplies its own strict CSP instead of inheriting the
     * application's CSP, which blocks the inline CSS used by real emails.
     */
    public static function render(string $html, array $cidImages = [], bool $showExternalImages = false): string
    {
        $previous = libxml_use_internal_errors(true);
        $document = new DOMDocument('1.0', 'UTF-8');
        try {
            $document->loadHTML(
                '<?xml encoding="UTF-8"?>'.$html,
                LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING
            );
            foreach (iterator_to_array($document->childNodes) as $child) {
                if ($child->nodeType === XML_PI_NODE) $document->removeChild($child);
            }
            foreach (iterator_to_array($document->getElementsByTagName('*')) as $element) {
                if ($element->parentNode !== null) {
                    self::clean($element, $cidImages, $showExternalImages);
                }
            }

            $head = $document->getElementsByTagName('head')->item(0);
            if ($head instanceof DOMElement) {
                $style = $document->createElement('style');
                $style->appendChild($document->createTextNode(
                    'html,body{margin:0}body{padding:0;overflow-wrap:anywhere;color:#202124;font:14px/1.5 Arial,Helvetica,sans-serif}'.
                    'img{max-width:100%;height:auto}table{max-width:100%}a{color:#1967d2}'
                ));
                $head->insertBefore($style, $head->firstChild);
            }

            // Add a single integrity-hashed script after removing sender scripts.
            // The iframe has an opaque origin (never allow-same-origin).
            $body = $document->getElementsByTagName('body')->item(0);
            if ($body instanceof DOMElement) {
                $resize = $document->createElement('script');
                $resize->setAttribute('data-mail-resize', '1');
                $resize->appendChild($document->createTextNode(self::resizeScript()));
                $body->appendChild($resize);
            }

            return $document->saveHTML() ?: '<!doctype html><html><body>Email could not be displayed.</body></html>';
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    /**
     * Email templates may use protocol-relative or HTTP-only URL syntax even
     * though the viewer itself is HTTPS. Normalize them to secure URLs instead
     * of deleting the image and leaving only the alt text.
     */
    private static function imageSource(string $value, array $cidImages, bool $showExternalImages): ?string
    {
        $value = trim($value);
        if ($value === '' || preg_match('/[\\x00-\\x1F\\x7F]/', $value)) return null;

        if (stripos($value, 'cid:') === 0) {
            $id = strtolower(trim(rawurldecode(substr($value, 4)), " <>\\t\\r\\n"));
            return $cidImages[$id] ?? null;
        }

        if (preg_match('~^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$~iD', $value)) {
            return strlen($value) <= 1600000 ? $value : null;
        }

        if (! $showExternalImages || strlen($value) > 4096) return null;

        if (str_starts_with($value, '//')) {
            $value = 'https:'.$value;
        } elseif (stripos($value, 'http://') === 0) {
            $value = 'https://'.substr($value, 7);
        }

        if (preg_match('~^https://[^/\\s?#]+(?:[/?#][^\\s]*)?$~iD', $value) !== 1) {
            return null;
        }

        $host = parse_url($value, PHP_URL_HOST);
        if (! is_string($host) || $host === '') return null;
        // Reject URL-embedded credentials to avoid misleading image hosts.
        if (parse_url($value, PHP_URL_USER) !== null) return null;
        return $value;
    }

    private static function clean(DOMElement $element, array $cidImages, bool $showExternalImages): void
    {
        $tag = strtolower($element->tagName);

        if (in_array($tag, [
            'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
            'form', 'input', 'button', 'select', 'option', 'textarea',
            'meta', 'base', 'link', 'svg', 'math', 'video', 'audio', 'canvas',
            'template', 'portal',
        ], true)) {
            $element->parentNode?->removeChild($element);
            return;
        }

        if ($tag === 'style') {
            // Keep email layouts but prohibit stylesheet imports and remote fonts.
            $element->textContent = preg_replace(
                '/@import\b[^;]*;?/is',
                '',
                $element->textContent
            ) ?? '';
        }

        $originalSrcset = $tag === 'img' ? (string) $element->getAttribute('srcset') : '';
        foreach (iterator_to_array($element->attributes) as $attribute) {
            $name = strtolower($attribute->name);
            $value = trim($attribute->value);

            if (str_starts_with($name, 'on') ||
                in_array($name, ['srcdoc', 'srcset', 'formaction', 'action', 'ping', 'integrity', 'nonce'], true) ||
                str_starts_with($name, 'xlink:')) {
                $element->removeAttributeNode($attribute);
                continue;
            }

            if ($name === 'href') {
                if ($tag !== 'a' || preg_match('~^(https?://|mailto:|tel:)~i', $value) !== 1 ||
                    preg_match('/[\x00-\x1f\x7f]/', $value)) {
                    $element->removeAttributeNode($attribute);
                }
                continue;
            }

            if ($name === 'src') {
                if ($tag !== 'img') {
                    $element->removeAttribute('src');
                    continue;
                }
                $safe = self::imageSource($value, $cidImages, $showExternalImages);
                if ($safe === null) $element->removeAttribute('src');
                else $element->setAttribute('src', $safe);
                continue;
            }

            if ($name === 'background') {
                $safe = self::imageSource($value, $cidImages, $showExternalImages);
                if ($safe !== null) {
                    $element->setAttribute('background', $safe);
                    continue;
                }
                $element->removeAttribute('background');
            }
        }

        // An image may have no src at all: Gmail-compatible templates often
        // rely solely on srcset. Resolve after stripping all untrusted attrs.
        if ($tag === 'img' && ! $element->hasAttribute('src') && $originalSrcset !== '' &&
            preg_match('~(?:https?:)?//[^\\s,]+~i', $originalSrcset, $candidate) === 1) {
            $safe = self::imageSource($candidate[0], $cidImages, $showExternalImages);
            if ($safe !== null) $element->setAttribute('src', $safe);
        }

        if ($tag === 'a') {
            $element->setAttribute('target', '_blank');
            $element->setAttribute('rel', 'noopener noreferrer nofollow');
        }
    }
}
