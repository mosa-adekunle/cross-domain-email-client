const domainOrder = ['receiptboss.ca', 'santasbag.ca', 'madenorth.dev', 'delishearsentertainment.com', 'madekunle.com'];
const domainRank = (domain) => { const index = domainOrder.indexOf(domain); return index < 0 ? domainOrder.length : index; };

export function groupMailboxes(mailboxes) {
  const groups = new Map();
  for (const mailbox of mailboxes) {
    const domain = (mailbox.domain_name || mailbox.address.split('@').pop()).toLowerCase();
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(mailbox);
  }
  const isCatchall = (mailbox) => (mailbox.local_part || mailbox.address.split('@')[0]).toLowerCase() === 'catchall';
  return [...groups.entries()].sort(([a], [b]) => domainRank(a) - domainRank(b) || a.localeCompare(b)).map(([domain, items]) => ({
    domain,
    mailboxes: items.sort((a, b) => Number(isCatchall(a)) - Number(isCatchall(b)) || a.address.localeCompare(b.address)),
  }));
}
