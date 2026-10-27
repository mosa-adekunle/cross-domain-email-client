import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Mail selects the original favicon in light mode and approved exact color inversion in dark mode', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const light = readFileSync(new URL('../public/favicon-made-north.svg', import.meta.url), 'utf8');
  const dark = readFileSync(new URL('../public/favicon-made-north-dark-original-inverted.svg', import.meta.url), 'utf8');
  assert.equal(dark, light.replaceAll('fill="#fff"', 'fill="#000000"')
    .replaceAll('fill="#001220"', 'fill="#FFFFFF"'), 'Only requested colors may change');
  const links = [...page.matchAll(/<link\s+rel="icon"[^>]*>/g)].map(m => m[0]);
  assert.equal(links.length, 2);
  assert.match(links[0], /media="\(prefers-color-scheme: light\)" href="\/favicon-made-north\.svg\?rev=original-20261027"/);
  assert.match(links[1], /media="\(prefers-color-scheme: dark\)" href="\/favicon-made-north-dark-original-inverted\.svg\?rev=approved-20261027"/);
});
