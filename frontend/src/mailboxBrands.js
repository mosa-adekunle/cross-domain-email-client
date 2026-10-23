const brands = {
  'receiptboss.ca': { color: '#00b895', tint: '#e0f6f0', logo: '/brands/receiptboss.svg' },
  'santasbag.ca': { color: '#E83A2F', tint: '#fdebe9', logo: '/brands/santasbag.svg' },
  'madenorth.dev': { color: '#d50012', tint: '#fde8ea', logo: '/brands/made-north.svg' },
};
export function mailboxBrand(domain) {
  const brand = brands[domain];
  if (!brand) return { initials: domain === 'delishearsentertainment.com' ? 'DE' : domain === 'madekunle.com' ? 'MA' : domain.slice(0, 2).toUpperCase() };
  return { logo: brand.logo, style: { '--mailbox-brand': brand.color, '--mailbox-tint': brand.tint } };
}
