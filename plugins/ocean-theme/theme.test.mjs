import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const css = readFileSync(new URL(manifest.bb.themes[0].css, import.meta.url), 'utf8');
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
const tokens = blocks.map(([, , body]) => new Map(
  [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value]),
));

test('both modes explicitly override the same tokens without layout or font changes', () => {
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0][1].trim().endsWith(':root,\n.light'));
  assert.equal(blocks[1][1].trim(), '.dark');
  assert.deepEqual([...tokens[0].keys()], [...tokens[1].keys()]);
  for (const [, , body] of blocks) {
    assert.equal(body.replace(/--[\w-]+:\s*[^;]+;/g, '').trim(), '');
  }
  assert.doesNotMatch(css, /--font|url\(|@import/);
});

test('Ocean source anchors, blue focus, and teal actions are preserved', () => {
  assert.equal(tokens[0].get('--canvas'), 'oklch(0.974199 0.002856 241.597)');
  assert.equal(tokens[1].get('--canvas'), 'oklch(0.242641 0.024125 250.573)');
  assert.equal(tokens[1].get('--sidebar'), 'oklch(0.290387 0.032043 247.274)');
  assert.equal(tokens[1].get('--ring'), 'oklch(0.758933 0.105833 241.548)');
  assert.equal(tokens[1].get('--primary'), 'oklch(0.793363 0.105022 199.893)');
});
