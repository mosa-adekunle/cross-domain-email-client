<?php

namespace App\Support;

use DOMDocument;
use DOMElement;
use DOMNode;

final class SafeMailHtml
{
    // Only formatting and ordinary links/images may leave the composer.
    private const TAGS = ['p','div','br','b','strong','i','em','u','s','strike','ul','ol','li','blockquote','a','img','span','h1','h2','h3','h4','hr','table','thead','tbody','tr','td','th','pre','code'];

    public static function sanitize(string $html): string
    {
        if (trim($html) === '') return '';
        if (! class_exists(DOMDocument::class)) {
            return nl2br(htmlspecialchars(strip_tags($html), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        }

        $previous = libxml_use_internal_errors(true);
        $document = new DOMDocument('1.0', 'UTF-8');
        try {
            $document->loadHTML('<?xml encoding="UTF-8"><html><body>'.$html.'</body></html>', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
            $body = $document->getElementsByTagName('body')->item(0);
            if (! $body) return '';
            foreach (iterator_to_array($body->childNodes) as $node) self::clean($node);
            $clean = '';
            foreach ($body->childNodes as $node) $clean .= $document->saveHTML($node);
            return $clean;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    private static function clean(DOMNode $node): void
    {
        if (! $node instanceof DOMElement) return;
        $tag = strtolower($node->tagName);
        if (in_array($tag, ['script','style','iframe','object','embed','form','svg','math','link','meta','base','video','audio'], true)) {
            $node->parentNode?->removeChild($node);
            return;
        }
        foreach (iterator_to_array($node->childNodes) as $child) self::clean($child);
        if (! in_array($tag, self::TAGS, true)) {
            while ($node->firstChild) $node->parentNode?->insertBefore($node->firstChild, $node);
            $node->parentNode?->removeChild($node);
            return;
        }
        foreach (iterator_to_array($node->attributes) as $attribute) {
            $name = strtolower($attribute->name);
            $value = trim($attribute->value);
            $allowed = false;
            if ($tag === 'a' && $name === 'href') {
                $allowed = preg_match('~^(https?://|mailto:|tel:)~i', $value) === 1;
            } elseif ($tag === 'img' && $name === 'src') {
                $allowed = preg_match('~^https?://~i', $value) === 1;
            } elseif ($tag === 'img' && in_array($name, ['alt','width','height'], true)) {
                $allowed = $name === 'alt' || preg_match('/^\d{1,4}$/', $value) === 1;
            } elseif ($name === 'style') {
                $allowed = self::safeStyle($value);
            }
            if (! $allowed) $node->removeAttributeNode($attribute);
        }
        if ($tag === 'a' && $node->hasAttribute('href')) {
            $node->setAttribute('rel', 'noopener noreferrer');
        }
    }

    private static function safeStyle(string $style): bool
    {
        if (strlen($style) > 500 || preg_match('/url\s*\(|expression\s*\(|[@<>\\]/i', $style)) return false;
        foreach (explode(';', $style) as $declaration) {
            $declaration = trim($declaration);
            if ($declaration === '') continue;
            if (! preg_match('/^(color|background-color|font-size|font-weight|font-style|font-family|line-height|text-align|text-decoration|margin|padding|border|border-radius|width|height|max-width)\s*:\s*([#a-zA-Z0-9 (),.%\-]+)$/i', $declaration)) return false;
        }
        return true;
    }
}
