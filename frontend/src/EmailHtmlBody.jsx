import React, { useEffect, useState } from 'react';

/**
 * The HTML view is a real, authenticated HTTP response with its own restrictive
 * CSP. srcDoc inherits the parent app's CSP, which rejects the inline styles
 * used by almost every marketing/transactional email.
 */
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

export default function EmailHtmlBody({ messageId, plainText = '' }) {
  const [showExternalImages, setShowExternalImages] = useState(false);
  const [showPlainText, setShowPlainText] = useState(false);

  useEffect(() => {
    setShowExternalImages(false);
    setShowPlainText(false);
  }, [messageId]);

  return <div className="message-rich-body">
    <div className="message-rich-controls">
      <span>Formatted email</span>
      {!showPlainText && <span className="message-image-status">
        {showExternalImages ? 'External images are visible' : 'External images are blocked for privacy'}
      </span>}
      {!showPlainText && <button type="button" onClick={() => setShowExternalImages(value => !value)}>
        {showExternalImages ? 'Block external images' : 'Show external images'}
      </button>}
      <button type="button" onClick={() => setShowPlainText(value => !value)}>
        {showPlainText ? 'View formatted email' : 'View plain text'}
      </button>
    </div>
    {showPlainText ? (
      <div className="message-text message-plain-fallback"><LinkedPlainText text={plainText || 'No plain-text version is available.'} /></div>
    ) : (
      <iframe
        className="message-rich-frame"
        title="Formatted email content"
        src={'/message-html/' + encodeURIComponent(messageId) + '?images=' + (showExternalImages ? '1' : '0')}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
    )}
  </div>;
}
