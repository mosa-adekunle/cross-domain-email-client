export const MAIL_BASE_TITLE = 'Mail - Made North Technologies';

export function mailPageTitle(totalUnreadCount) {
  const count = Number(totalUnreadCount);
  if (!Number.isSafeInteger(count) || count <= 0) return MAIL_BASE_TITLE;
  return `(${count} new) ${MAIL_BASE_TITLE}`;
}
