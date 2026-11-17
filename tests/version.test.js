// Версии файлов в index.html и проверка, что открытая вкладка устарела.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileVersions, siteVersion, stampedIndex } from '../tools/stamp-version.mjs';
import { installDom } from './helpers.js';

installDom();
const { latestVersion, siteOutdated, versionFromHtml } = await import('../js/version.js');

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('index.html: версии файлов актуальны (иначе: node tools/stamp-version.mjs)', () => {
  assert.equal(stampedIndex(index, fileVersions()), index);
});

test('index.html: каждый модуль из js/ — в карте импортов, main.js и стили — со своей версией', () => {
  const versions = fileVersions();
  Object.entries(versions).forEach(([file, version]) => {
    if (file === 'js/main.js') assert.ok(index.includes(`src="js/main.js?v=${version}"`));
    else if (file.startsWith('js/')) assert.ok(index.includes(`"./${file}": "./${file}?v=${version}"`), file);
    else assert.ok(index.includes(`${file}?v=${version}"`), file);
  });
  assert.equal(versionFromHtml(index), siteVersion(versions));
  // Карта импортов — до первого модуля, иначе браузер её не применит.
  assert.ok(index.indexOf('type="importmap"') < index.indexOf('type="module"'));
});

test('stampedIndex: изменился один файл — меняются его метка и версия сайта, остальные метки те же', () => {
  const versions = fileVersions();
  const changed = { ...versions, 'js/order.js': '0000000000' };
  const next = stampedIndex(index, changed);
  assert.ok(next.includes('"./js/order.js": "./js/order.js?v=0000000000"'));
  assert.ok(next.includes(`"./js/state.js": "./js/state.js?v=${versions['js/state.js']}"`));
  assert.notEqual(versionFromHtml(next), versionFromHtml(index));
  assert.equal(stampedIndex(next, changed), next, 'повторный запуск ничего не меняет');
});

test('siteOutdated: версия опубликованного сайта другая — да; та же, сбой сети или нет версии — нет', async () => {
  globalThis.location = { href: 'https://calc.fb-print.ru/#orders' };
  const page = version => async url => {
    assert.match(String(url), /^https:\/\/calc\.fb-print\.ru\/index\.html\?check=\d+$/);
    return { ok: true, text: async () => `<meta name="app-version" content="${version}">` };
  };
  globalThis.document.querySelector = selector => (selector === 'meta[name="app-version"]' ? { content: 'aaaaaaaaaa' } : null);
  assert.equal(await siteOutdated(page('bbbbbbbbbb')), true);
  assert.equal(await siteOutdated(page('aaaaaaaaaa')), false);
  assert.equal(await siteOutdated(async () => { throw new TypeError('offline'); }), false);
  assert.equal(await siteOutdated(async () => ({ ok: false, text: async () => '' })), false);
  assert.equal(await latestVersion(async () => ({ ok: true, text: async () => '<html></html>' })), '');
  globalThis.document.querySelector = () => null;
  assert.equal(await siteOutdated(page('bbbbbbbbbb')), false, 'локальный запуск без версии не перезагружается');
});
