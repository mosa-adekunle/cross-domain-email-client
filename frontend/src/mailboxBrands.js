const brands = {
  'receiptboss.ca': { color: '#00b895', ink: '#007862', tint: '#e0f6f0', logo: '/brands/receiptboss.svg' },
  'santasbag.ca': { color: '#E83A2F', ink: '#b52c23', tint: '#fdebe9', logo: '/brands/santasbag.svg' },
  'madenorth.dev': { color: '#d50012', ink: '#b0000f', tint: '#fde8ea', logo: '/brands/made-north.svg' },
};
export function mailboxBrand(domain) {
  const brand = brands[domain];
  if (!brand) return { initials: domain === 'delishearsentertainment.com' ? 'DE' : domain === 'madekunle.com' ? 'MA' : domain.slice(0, 2).toUpperCase() };
  return { logo: brand.logo, style: { '--mailbox-brand': brand.color, '--mailbox-ink': brand.ink, '--mailbox-tint': brand.tint } };
}
