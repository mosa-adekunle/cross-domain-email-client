// Mail location is stored in the URL so browser refresh and history
// navigation preserve the chosen folder and mailbox. Keep unrelated query
// parameters intact (including links carrying marketing parameters).
export const mailFolderIds = Object.freeze(['inbox', 'sent', 'drafts', 'archive', 'trash', 'settings']);

export function readMailLocation(search) {
  const params = new URLSearchParams(search);
  const folder = params.get('folder');
  const mailboxId = params.get('mailbox_id') || '';
  const messageId = params.get('message') || '';
  return {
    folder: mailFolderIds.includes(folder) ? folder : 'inbox',
    mailboxId: /^[1-9][0-9]*$/.test(mailboxId) ? mailboxId : '',
    messageId: /^[1-9][0-9]*$/.test(messageId) ? messageId : null,
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
  // Changing folders closes a currently opened message.
  url.searchParams.delete('message');
  return url.pathname + url.search + url.hash;
}
