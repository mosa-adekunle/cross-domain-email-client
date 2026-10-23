export function groupMailboxes(mailboxes) {
  const groups = new Map();
  for (const mailbox of mailboxes) {
    const domain = (mailbox.domain_name || mailbox.address.split('@').pop()).toLowerCase();
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(mailbox);
  }
  const isCatchall = (mailbox) => (mailbox.local_part || mailbox.address.split('@')[0]).toLowerCase() === 'catchall';
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([domain, items]) => ({
    domain,
    mailboxes: items.sort((a, b) => Number(isCatchall(a)) - Number(isCatchall(b)) || a.address.localeCompare(b.address)),
  }));
}
