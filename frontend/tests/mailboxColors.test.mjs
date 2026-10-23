import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mailboxBrand } from '../src/mailboxBrands.js';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('Domain headings and email addresses use standard mailbox text colours', () => {
  assert.match(styles, /\.mailbox-domain-group > summary \{ color: #53647c; \}/);
  assert.match(styles, /\.mailbox-domain-group > summary:hover \{ color: #174ea6; \}/);
  assert.match(styles, /\.mailbox-domain-group \.mailbox-link\.selected:hover \{ color: #174ea6; \}/);
  assert.doesNotMatch(styles, /--mailbox-ink/);
});

test('Brand logos stay available without changing mailbox text colours', () => {
  const known = [
    ['receiptboss.ca', '/brands/receiptboss.svg'],
    ['santasbag.ca', '/brands/santasbag.svg'],
    ['madenorth.dev', '/brands/made-north.svg'],
  ];
  for (const [domain, logo] of known) {
    const presentation = mailboxBrand(domain);
    assert.equal(presentation.logo, logo);
    assert.ok(presentation.style['--mailbox-brand']);
    assert.ok(presentation.style['--mailbox-tint']);
    assert.ok(!Object.hasOwn(presentation.style, '--mailbox-ink'));
  }
  for (const domain of ['delishearsentertainment.com', 'madekunle.com']) {
    assert.ok(mailboxBrand(domain).initials);
  }
});
