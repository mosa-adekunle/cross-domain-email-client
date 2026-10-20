import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Serve the worker from our own HTTPS origin. Never load email content or
// executable viewer code from a third-party URL.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export default function PdfAttachmentPreview({ bytes, filename }) {
  const canvasRef = useRef(null);
  const [document, setDocument] = useState(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('Loading PDF…');
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    const task = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
      stopAtErrors: true,
    });
    setStatus('Loading PDF…');
    setError('');
    setDocument(null);
    setTotalPages(0);
    setPageNumber(1);
    task.promise.then((loaded) => {
      if (disposed) {
        loaded.destroy();
        return;
      }
      setDocument(loaded);
      setTotalPages(loaded.numPages);
    }).catch((cause) => {
      if (!disposed) {
        setStatus('');
        // Do not log attachment bytes, filename, or private R2 object keys.
        // The exception category is sufficient to distinguish corrupt PDFs
        // from the production Nginx ES-module worker MIME configuration.
        const category = String(cause?.name || 'UnknownError');
        console.warn('PDF preview initialization failed:', category);
        const details = String(cause?.message || '');
        const workerProblem = /fake worker|worker script|module script|dynamically imported|failed to fetch|workerSrc/i.test(details);
        const invalidPdf = category === 'InvalidPDFException' || /invalid pdf|missing pdf/i.test(details);
        setError(workerProblem
          ? 'The PDF viewer could not load its worker script. Verify the .mjs JavaScript MIME type on the server.'
          : invalidPdf
            ? 'This attachment does not contain a valid readable PDF. Download it to check the original file.'
            : 'The PDF could not be opened. You can still download the original attachment.');
      }
    });
    return () => {
      disposed = true;
      task.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    if (!document || !canvasRef.current) return undefined;
    let stopped = false;
    let renderTask = null;
    setStatus('Rendering page…');
    setError('');

    (async () => {
      const page = await document.getPage(pageNumber);
      if (stopped || !canvasRef.current) return;

      const viewport = page.getViewport({ scale: zoom });
      // Bound canvas memory even for unusually large/malicious PDF pages.
      const deviceRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      const pixelRatio = Math.min(deviceRatio, Math.sqrt(12000000 / Math.max(1, viewport.width * viewport.height)));
      if (!Number.isFinite(pixelRatio) || pixelRatio < 0.1) throw new Error('Page too large');

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas unavailable');
      canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';

      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      await renderTask.promise;
      if (!stopped) setStatus('');
    })().catch((cause) => {
      if (!stopped && cause?.name !== 'RenderingCancelledException') {
        setStatus('');
        setError('This PDF page could not be displayed. Download the attachment to open it externally.');
      }
    });
    return () => {
      stopped = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, zoom]);

  return (
    <div className="attachment-pdf-viewer" aria-label={'PDF preview: ' + filename}>
      {totalPages > 0 && (
        <div className="attachment-pdf-controls">
          <button type="button" onClick={() => setPageNumber((page) => Math.max(1, page - 1))} disabled={pageNumber <= 1} aria-label="Previous PDF page">← Previous</button>
          <span>Page {pageNumber} of {totalPages}</span>
          <button type="button" onClick={() => setPageNumber((page) => Math.min(totalPages, page + 1))} disabled={pageNumber >= totalPages} aria-label="Next PDF page">Next →</button>
          <span className="attachment-pdf-control-spacer" />
          <button type="button" onClick={() => setZoom((value) => Math.max(0.6, Math.round((value - 0.2) * 10) / 10))} disabled={zoom <= 0.6} aria-label="Zoom out">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(2, Math.round((value + 0.2) * 10) / 10))} disabled={zoom >= 2} aria-label="Zoom in">+</button>
        </div>
      )}
      {error && <div className="attachment-pdf-error" role="alert">{error}</div>}
      {status && !error && <div className="attachment-pdf-status" role="status">{status}</div>}
      <div className="attachment-pdf-canvas-scroll">
        <canvas ref={canvasRef} aria-label={'PDF page ' + pageNumber} />
      </div>
    </div>
  );
}
