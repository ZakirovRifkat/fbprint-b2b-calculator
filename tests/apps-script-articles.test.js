// Вкладка «Артикулы» у администратора: articleLayouts и layoutPreviews в поддельном Apps Script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISK_ORDERS, DISK_ROOT, TEST_PASSWORDS, loadCodeGs, plain } from './gas-harness.js';

const ADMIN = TEST_PASSWORDS.admin;
const CLIENT = TEST_PASSWORDS.client;
const LAYOUTS = ['ГФ_10165_3_80x120.jpg', 'ГФ_10350_1.jpg', 'ГФ_10350_2.jpg', 'ГФ_15053_D35.jpg', 'ГФ_10338_D80.jpg'];
const path = name => `${DISK_ROOT}/${name}`;

test('articleLayouts: только администратору и только с токеном Диска', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  assert.equal(h.call({ action: 'articleLayouts', password: CLIENT }).error.code, 'ADMIN_REQUIRED');
  assert.equal(h.call({ action: 'layoutPreviews', password: CLIENT, paths: [path('ГФ_10165_3_80x120.jpg')] }).error.code, 'ADMIN_REQUIRED');
  assert.deepEqual(h.disk.requests, []);

  const noToken = loadCodeGs({ props: { YANDEX_DISK_TOKEN: null } });
  assert.equal(noToken.call({ action: 'articleLayouts', password: ADMIN }).error.code, 'LAYOUTS_NOT_CONFIGURED');
});

test('articleLayouts: каждый артикул листа со своим макетом, проблемой и номером строки', () => {
  const h = loadCodeGs({ layouts: LAYOUTS, sheetOptions: { layoutColumn: true, gfLayouts: { 10338: 'ГФ_10338_old.jpg' } } });
  const reply = h.call({ action: 'articleLayouts', password: ADMIN });
  assert.equal(reply.ok, true);
  assert.equal(reply.role, 'admin');
  assert.equal(reply.files, LAYOUTS.length);
  assert.deepEqual(reply.companies.map(c => c.id), ['global_food', 'studio_vkusa']);

  const find = (companyId, sku) => reply.articles.filter(a => a.companyId === companyId && a.sku === sku);
  const [first] = find('global_food', '10165');
  assert.equal(first.row, 3);
  assert.equal(first.name, 'Этикетка 10165');
  assert.equal(first.layout, 'ГФ_10165_3_80x120.jpg');
  assert.equal(first.path, path('ГФ_10165_3_80x120.jpg'));
  assert.equal(first.problem, '');
  assert.match(first.url, /^https:\/\/disk\.yandex\.ru\/client\/disk\/.+\?idApp=client&dialog=slider&idDialog=%2Fdisk%2F/);
  assert.equal(decodeURIComponent(first.url.split('idDialog=')[1]), `/disk/${path('ГФ_10165_3_80x120.jpg').slice('disk:/'.length)}`);

  // Общий артикул: у обеих компаний один и тот же файл.
  assert.equal(find('global_food', '15053')[0].path, find('studio_vkusa', '15053')[0].path);
  // Два файла по правилу имени — макета нет, кандидаты названы.
  assert.deepEqual(plain(find('global_food', '10350')[0]).candidates, ['ГФ_10350_1.jpg', 'ГФ_10350_2.jpg']);
  assert.equal(find('global_food', '10350')[0].problem, 'conflict');
  assert.equal(find('global_food', '10350')[0].url, '');
  // Файла нет вовсе.
  assert.equal(find('global_food', '10003')[0].problem, 'missing');
  // В колонке «Макет» имя, которого нет на Диске.
  assert.equal(find('global_food', '10338')[0].problem, 'notFound');
  // Артикул дважды на листе — обе строки в списке.
  assert.deepEqual(find('global_food', '19743').map(a => a.row), [13, 14]);
});

test('articleLayouts: Диск не принимает токен — понятная ошибка', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  h.disk.validToken = 'other';
  const reply = h.call({ action: 'articleLayouts', password: ADMIN });
  assert.equal(reply.error.code, 'ARTICLES_READ_FAILED');
  assert.match(reply.error.message, /YANDEX_DISK_TOKEN/);
});

test('layoutPreviews: картинка с токеном, потом из кэша без Диска', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const file = path('ГФ_10165_3_80x120.jpg');
  const reply = h.call({ action: 'layoutPreviews', password: ADMIN, paths: [file, file] });
  assert.equal(reply.ok, true);
  assert.deepEqual(Object.keys(reply.previews), [file]);
  assert.equal(reply.previews[file], `data:image/jpeg;base64,${Buffer.from(file, 'utf8').toString('base64')}`);
  assert.deepEqual(h.disk.previewDownloads, [file]);
  assert.equal(h.disk.requests.find(r => r.kind === 'previewInfo').query.preview_size, 'M');

  const before = h.disk.requests.length;
  const again = h.call({ action: 'layoutPreviews', password: ADMIN, paths: [file] });
  assert.equal(again.previews[file], reply.previews[file]);
  assert.equal(h.disk.requests.length, before);
  assert.deepEqual(h.disk.previewDownloads, [file]);
});

test('layoutPreviews: путь вне папки макетов и несуществующий файл — пустая строка, Диск не трогается зря', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  h.disk.addDir(DISK_ORDERS);
  h.disk.addFile(`${DISK_ORDERS}/секрет.jpg`);
  const outside = [`${DISK_ORDERS}/секрет.jpg`, `${DISK_ROOT}/../секрет.jpg`, 'disk:/секрет.jpg'];
  const missing = path('ГФ_99999_1.jpg');
  const reply = h.call({ action: 'layoutPreviews', password: ADMIN, paths: [...outside, missing] });
  assert.deepEqual(plain(reply.previews), Object.fromEntries([...outside, missing].map(p => [p, ''])));
  assert.deepEqual(h.disk.requests.map(r => r.query.path), [missing]);
  assert.deepEqual(h.disk.previewDownloads, []);
});

test('layoutPreviews: не больше 12 путей за запрос', () => {
  const names = Array.from({ length: 15 }, (_, i) => `ГФ_${20000 + i}_1.jpg`);
  const h = loadCodeGs({ layouts: names });
  const reply = h.call({ action: 'layoutPreviews', password: ADMIN, paths: names.map(path) });
  assert.equal(Object.keys(reply.previews).length, 12);
  assert.equal(h.disk.previewDownloads.length, 12);
});

test('layoutPreviews: токен не принят — ошибка, а не пустые картинки', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  h.disk.validToken = 'other';
  const reply = h.call({ action: 'layoutPreviews', password: ADMIN, paths: [path('ГФ_10165_3_80x120.jpg')] });
  assert.equal(reply.error.code, 'LAYOUT_PREVIEW_FAILED');
});
