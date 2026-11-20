import React, { useEffect, useRef, useState } from 'react';

const IMAGE_PREFERENCE = 'cdec-external-mail-images';

function defaultExternalImages(isSpam) {
  if (isSpam) return false;
  try { return window.localStorage.getItem(IMAGE_PREFERENCE) !== 'blocked'; }
  catch { return true; }
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

export default function EmailHtmlBody({ messageId, plainText = '', isSpam = false }) {
  const [showExternalImages, setShowExternalImages] = useState(() => defaultExternalImages(isSpam));
  const [showPlainText, setShowPlainText] = useState(false);
  const [frameHeight, setFrameHeight] = useState(800);
  const frameRef = useRef(null);

  useEffect(() => {
    setShowExternalImages(defaultExternalImages(isSpam));
    setShowPlainText(false);
    setFrameHeight(800);
  }, [messageId, isSpam]);

  // The iframe is intentionally sandboxed to an opaque origin. Only its
  // SHA-256-authorized measurement script can send height measurements.
  // Never enable allow-same-origin just to read iframe DOM.
  useEffect(() => {
    function onMessage(event) {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== 'null') return;
      if (event.data?.type !== 'madenorth-email-height') return;
      const height = Number(event.data.height);
      if (!Number.isFinite(height) || height < 0) return;
      setFrameHeight(Math.max(320, Math.min(16000, Math.ceil(height + 2))));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function toggleImages() {
    setShowExternalImages(previous => {
      const next = !previous;
      if (!isSpam) {
        try { window.localStorage.setItem(IMAGE_PREFERENCE, next ? 'shown' : 'blocked'); }
        catch { /* Image preference falls back to the current message only. */ }
      }
      setFrameHeight(800);
      return next;
    });
  }

  const url = '/message-html/' + encodeURIComponent(messageId) + '?images=' + (showExternalImages ? '1' : '0');

  return <div className="message-rich-body">
    <div className="message-rich-controls">
      <span>Formatted email</span>
      {!showPlainText && <span className="message-image-status">
        {showExternalImages ? 'External images visible' : 'External images blocked'}
      </span>}
      {!showPlainText && <button type="button" onClick={toggleImages}>
        {showExternalImages ? 'Block external images' : 'Show external images'}
      </button>}
      <button type="button" onClick={() => setShowPlainText(value => !value)}>
        {showPlainText ? 'View formatted email' : 'View plain text'}
      </button>
      {!showPlainText && <a className="message-open-full" href={url} target="_blank" rel="noopener noreferrer">Open full email</a>}
    </div>
    {showPlainText ? (
      <div className="message-text message-plain-fallback"><LinkedPlainText text={plainText || 'No plain-text version is available.'} /></div>
    ) : (
      <iframe
        key={url}
        ref={frameRef}
        className="message-rich-frame"
        title="Formatted email content"
        src={url}
        style={{ height: frameHeight + 'px' }}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
    )}
  </div>;
}
