import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Mail favicon uses the square Made North corporate site favicon', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const favicon = readFileSync(new URL('../public/favicon-made-north.svg', import.meta.url), 'utf8');
  assert.ok(index.includes('href="/favicon-made-north.svg"'));
  assert.ok(!index.includes('rel="icon" type="image/svg+xml" href="/made-north-technologies-logo.svg"'));
  assert.match(favicon, /<svg\b/);
  assert.match(favicon, /viewBox="60 54 570 570"/);
  assert.match(favicon, /fill="#001220"/);
});
