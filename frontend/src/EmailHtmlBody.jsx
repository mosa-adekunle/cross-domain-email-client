import React, { useEffect, useMemo, useState } from 'react';

// Render sender-controlled markup only inside an opaque-origin iframe with
// scripts, forms, navigation of the parent, and remote resources disabled.
function safeDocument(html, allowImages, inlineImages) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script, iframe, frame, frameset, object, embed, form, input, button, link, meta, base, svg, math, video, audio').forEach(node => node.remove());
  parsed.querySelectorAll('*').forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    }
  });
  parsed.querySelectorAll('a').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(href.trim())) link.removeAttribute('href');
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer nofollow');
  });
  parsed.querySelectorAll('img').forEach(img => {
    const src = (img.getAttribute('src') || '').trim();
    if (/^cid:/i.test(src)) {
      const key = decodeURIComponent(src.slice(4)).replace(/^<|>$/g, '').toLowerCase();
      if (inlineImages[key]) img.setAttribute('src', inlineImages[key]);
      else img.removeAttribute('src');
    } else if (/^https?:\/\//i.test(src)) {
      if (!allowImages) img.removeAttribute('src');
    } else if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) {
      img.removeAttribute('src');
    }
    img.removeAttribute('srcset');
  });
  const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:" +
    (allowImages ? " https: http:" : "") +
    "; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
  const css = 'html,body{margin:0;padding:0;overflow-wrap:anywhere}body{padding:15px;color:#243650;font:14px/1.55 Arial,sans-serif}img{max-width:100%;height:auto}table{max-width:100%}a{color:#315bc8}';
  const style = Array.from(parsed.head.querySelectorAll('style')).map(tag => tag.textContent || '').join('\n');
  // CSP is first: sender HTML cannot override the sandbox's restrictions.
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
    policy.replace(/"/g, '&quot;') + '"><base target="_blank"><style>' + css + '</style><style>' +
    style.replace(/<\/style/gi, '<\\/style') + '</style></head><body>' + parsed.body.innerHTML + '</body></html>';
}

export function LinkedPlainText({ text }) {
  const pieces = String(text || '').split(/(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi);
  return pieces.map((piece, index) => {
    if (!/^(https?:\/\/|www\.)/i.test(piece)) return <React.Fragment key={index}>{piece}</React.Fragment>;
    const match = piece.match(/^(.*?)([.,;!?)]*)$/);
    const value = match?.[1] || piece;
    const trailing = match?.[2] || '';
    return <React.Fragment key={index}><a href={/^www\./i.test(value) ? 'https://' + value : value} target="_blank" rel="noopener noreferrer nofollow">{value}</a>{trailing}</React.Fragment>;
  });
}

export default function EmailHtmlBody({ html, attachments, messageId, onExpired }) {
  const [allowImages, setAllowImages] = useState(false);
  const [inlineImages, setInlineImages] = useState({});
  useEffect(() => {
    setAllowImages(false);
    setInlineImages({});
    let active = true;
    async function loadInline() {
      const inline = attachments.filter(file => file.content_id && /^(image\/png|image\/jpeg|image\/gif|image\/webp)$/i.test(file.content_type)).slice(0, 12);
      for (const file of inline) {
        try {
          const response = await fetch('/api/messages/' + encodeURIComponent(messageId) + '/attachments/' + file.index + '?preview=1', { credentials: 'same-origin', cache: 'no-store' });
          if (response.status === 401) { onExpired(); return; }
          if (!response.ok) continue;
          const blob = await response.blob();
          if (blob.size > 1024 * 1024 || !active) continue;
          const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
          if (active) setInlineImages(current => ({ ...current, [file.content_id.toLowerCase()]: data }));
        } catch { /* Keep a broken image placeholder; never load remote fallbacks. */ }
      }
    }
    loadInline();
    return () => { active = false; };
  }, [messageId, attachments, onExpired]);
  const srcDoc = useMemo(() => safeDocument(html, allowImages, inlineImages), [html, allowImages, inlineImages]);
  return <div className="message-rich-body">
    <div className="message-rich-controls">
      <span>HTML email · Links open in a separate tab</span>
      <button type="button" onClick={() => setAllowImages(value => !value)}>{allowImages ? 'Block external images' : 'Show external images'}</button>
    </div>
    <iframe className="message-rich-frame" title="Email content" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={srcDoc} />
  </div>;
}
