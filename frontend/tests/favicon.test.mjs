import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Mail uses the unchanged original Made North favicon for all color schemes', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const original = readFileSync(new URL('../public/favicon-made-north.svg', import.meta.url), 'utf8');
  const links = [...page.matchAll(/<link\s+rel="icon"[^>]*>/g)];
  assert.equal(links.length, 1, 'Only the original favicon should be selected');
  assert.match(links[0][0], /href="\/favicon-made-north\.svg\?rev=original-20261027"/);
  assert.doesNotMatch(page, /prefers-color-scheme|favicon-made-north-dark-v\d+\.svg/);
  assert.match(original, /<rect[^>]+fill="#fff"/);
  assert.match(original, /fill="#001220"/);
  assert.match(original, /fill="#D50012"/);
});
