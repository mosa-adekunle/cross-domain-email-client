<?php

namespace App\Support;

use DOMDocument;
use DOMElement;
use DOMNode;

final class ArchivedHtmlPreview
{
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
                    'html,body{min-height:100%;margin:0}body{padding:16px;overflow-wrap:anywhere;color:#202124;font:14px/1.5 Arial,Helvetica,sans-serif}'.
                    'img{max-width:100%;height:auto}table{max-width:100%}a{color:#1967d2}'
                ));
                $head->insertBefore($style, $head->firstChild);
            }

            return $document->saveHTML() ?: '<!doctype html><html><body>Email could not be displayed.</body></html>';
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
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
                    $element->removeAttributeNode($attribute);
                    continue;
                }

                if (stripos($value, 'cid:') === 0) {
                    $cid = strtolower(trim(rawurldecode(substr($value, 4)), " <>\t\r\n"));
                    if (isset($cidImages[$cid])) {
                        $element->setAttribute('src', $cidImages[$cid]);
                    } else {
                        $element->removeAttribute('src');
                    }
                } elseif (preg_match('~^https://~i', $value) !== 1 &&
                    preg_match('~^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$~iD', $value) !== 1) {
                    $element->removeAttribute('src');
                } elseif (stripos($value, 'https://') === 0 && ! $showExternalImages) {
                    $element->removeAttribute('src');
                } elseif (strlen($value) > 1600000) {
                    $element->removeAttribute('src');
                }
                continue;
            }

            if ($name === 'background') {
                if ($showExternalImages && preg_match('~^https://~i', $value) === 1) {
                    continue;
                }
                $element->removeAttribute('background');
            }
        }

        if ($tag === 'a') {
            $element->setAttribute('target', '_blank');
            $element->setAttribute('rel', 'noopener noreferrer nofollow');
        }
    }
}
