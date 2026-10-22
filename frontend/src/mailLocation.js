// Mail location is stored in the URL so browser refresh and history
// navigation preserve the chosen folder and mailbox. Keep unrelated query
// parameters intact (including links carrying marketing parameters).
export const mailFolderIds = Object.freeze(['inbox', 'sent', 'drafts', 'archive', 'trash', 'settings']);

export function readMailLocation(search) {
  const params = new URLSearchParams(search);
  const folder = params.get('folder');
  const mailboxId = params.get('mailbox_id') || '';
  const messageId = params.get('message') || '';
  const rawPage = params.get('page') || '';
  const page = /^[1-9][0-9]*$/.test(rawPage) && Number(rawPage) <= 10000
    ? Number(rawPage) : 1;
  return {
    folder: mailFolderIds.includes(folder) ? folder : 'inbox',
    mailboxId: /^[1-9][0-9]*$/.test(mailboxId) ? mailboxId : '',
    messageId: /^[1-9][0-9]*$/.test(messageId) ? messageId : null,
    page,
  };
}

export function mailLocationUrl(href, { folder, mailboxId }) {
  const url = new URL(href);
  if (mailFolderIds.includes(folder) && folder !== 'inbox') {
    url.searchParams.set('folder', folder);
  } else {
    url.searchParams.delete('folder');
  }
  if (/^[1-9][0-9]*$/.test(String(mailboxId ?? ''))) {
    url.searchParams.set('mailbox_id', String(mailboxId));
  } else {
    url.searchParams.delete('mailbox_id');
  }
  // Changing folders starts at the first page and closes the message.
  url.searchParams.delete('page');
  url.searchParams.delete('message');
  return url.pathname + url.search + url.hash;
}

export function mailPageUrl(href, page) {
  const url = new URL(href);
  if (Number.isSafeInteger(page) && page >= 2 && page <= 10000) {
    url.searchParams.set('page', String(page));
  } else {
    url.searchParams.delete('page');
  }
  url.searchParams.delete('message');
  return url.pathname + url.search + url.hash;
}

export function messagePageRange(pagination, page) {
  const total = Math.max(0, Number(pagination?.total) || 0);
  const perPage = Math.max(1, Number(pagination?.per_page) || 50);
  if (total === 0) return { start: 0, end: 0, total };
  return {
    start: Math.min(total, (page - 1) * perPage + 1),
    end: Math.min(total, page * perPage),
    total,
  };
}
