import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Mail favicon switches to the transparent white/red Made North logo in dark mode', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const light = readFileSync(new URL('../public/favicon-made-north.svg', import.meta.url), 'utf8');
  const dark = readFileSync(new URL('../public/favicon-made-north-dark-v1.svg', import.meta.url), 'utf8');
  assert.match(index, /media="\(prefers-color-scheme: light\)" href="\/favicon-made-north\.svg"/);
  assert.match(index, /media="\(prefers-color-scheme: dark\)" href="\/favicon-made-north-dark-v1\.svg"/);
  assert.match(light, /<rect[^>]+fill="#fff"/);
  assert.match(light, /viewBox="60 54 570 570"/);
  assert.doesNotMatch(dark, /<rect\b/);
  assert.equal((dark.match(/fill="#FFFFFF"/g) || []).length, 3);
  assert.match(dark, /fill="#D50012"/);
  assert.equal(dark, light.replace(/<rect x="60" y="54" width="570" height="570" rx="90" fill="#fff"\/>\n/, '\n')
    .replaceAll('fill="#001220"', 'fill="#FFFFFF"'));
});
