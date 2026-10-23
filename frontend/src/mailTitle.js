export const MAIL_BASE_TITLE = 'Mail - Made North Technologies';

export function shouldPulseMailTitle(totalUnreadCount, reducedMotion = false) {
  const count = Number(totalUnreadCount);
  return !reducedMotion && Number.isSafeInteger(count) && count > 0;
}

export function mailPageTitle(totalUnreadCount, pulsed = false) {
  const count = Number(totalUnreadCount);
  if (!Number.isSafeInteger(count) || count <= 0) return MAIL_BASE_TITLE;
  const unreadTitle = `(${count} new) ${MAIL_BASE_TITLE}`;
  return `${pulsed ? '🟢' : '🔴'} ${unreadTitle}`;
}
