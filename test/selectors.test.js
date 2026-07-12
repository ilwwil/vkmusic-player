const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { installDomStubs } = require('./dom-stub');

installDomStubs();
require(path.join('..', 'selectors.js'));
const SELECTORS = global.window.VK_SELECTORS;

test('VK_SELECTORS is populated with non-empty selector lists', () => {
  assert.ok(SELECTORS && typeof SELECTORS === 'object');
  const keys = Object.keys(SELECTORS);
  assert.ok(keys.length > 0);
  for (const key of keys) {
    const list = SELECTORS[key];
    assert.ok(Array.isArray(list), `${key} should be an array`);
    assert.ok(list.length > 0, `${key} should not be empty`);
    for (const sel of list) {
      assert.equal(typeof sel, 'string');
      assert.ok(sel.trim().length > 0, `${key} has a blank selector`);
    }
  }
});

test('key selectors relied on elsewhere in the app are present', () => {
  // Эти ключи читаются напрямую по имени в views/*.js и renderer.js — если
  // кто-то их переименует в selectors.js, автоматизация тихо сломается.
  for (const key of ['trackTitle', 'playPauseButton', 'catalogTabAllMusic', 'progressSlider']) {
    assert.ok(SELECTORS[key], `missing expected selector key: ${key}`);
  }
});
