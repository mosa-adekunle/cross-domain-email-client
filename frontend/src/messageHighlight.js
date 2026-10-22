// The reader's actual mailbox/folder is a visual highlight, not a list
// filter. Preserve the user's All mailboxes selection when returning Back.
export function messageNavigationHighlight({ openedMessageId, messageContext, activeFolder, selectedMailbox, mailboxes, folders }) {
  const viewingMessage = Boolean(openedMessageId);
  const loaded = viewingMessage && messageContext && String(messageContext.id) === String(openedMessageId);
  if (!loaded) {
    return { folderLabel: activeFolder, mailboxId: viewingMessage ? null : String(selectedMailbox || '') };
  }

  const matchingFolder = folders.find((entry) => entry.folder === messageContext.folder);
  const mailbox = mailboxes.find((entry) =>
    String(entry.id) === String(messageContext.mailbox_id)
    || String(entry.address).toLowerCase() === String(messageContext.mailbox_address || '').toLowerCase()
  );
  return {
    folderLabel: matchingFolder?.label || activeFolder,
    mailboxId: mailbox ? String(mailbox.id) : null,
  };
}
