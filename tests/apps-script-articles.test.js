// Вкладка «Артикулы» у администратора: articleLayouts и layoutPreviews в поддельном Apps Script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISK_ORDERS, DISK_ROOT, GF, SV, TEST_PASSWORDS, loadCodeGs, plain } from './gas-harness.js';

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
  assert.equal(first.category, '1');
  assert.equal(first.layoutCell, '');
  assert.deepEqual(plain(reply.fileNames), [...LAYOUTS].sort());
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

test('layoutPreviews: размер XL для просмотра крупно, неизвестный размер — M; кэш у размеров свой', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const file = path('ГФ_10165_3_80x120.jpg');
  assert.equal(h.call({ action: 'layoutPreviews', password: ADMIN, paths: [file] }).size, 'M');
  const big = h.call({ action: 'layoutPreviews', password: ADMIN, paths: [file], size: 'XL' });
  assert.equal(big.size, 'XL');
  assert.ok(big.previews[file].startsWith('data:image/jpeg;base64,'));
  assert.equal(h.call({ action: 'layoutPreviews', password: ADMIN, paths: [file], size: 'XXXL' }).size, 'M');
  const sizes = h.disk.requests.filter(r => r.kind === 'previewInfo').map(r => r.query.preview_size);
  assert.deepEqual(sizes, ['M', 'XL']);
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

// ───── Изменение артикулов ─────

const article = (over = {}) => ({ category: '1', sku: '30001', size: '80 х 120', color: 'Цветная', name: 'ЭТИКЕТКА НОВАЯ', layout: '', ...over });
const sheetRow = (h, name, row) => h.sheets[name].data[row - 1];

test('saveArticle: только администратору', () => {
  const h = loadCodeGs();
  assert.equal(h.call({ action: 'saveArticle', password: CLIENT, company: 'global_food', article: article() }).error.code, 'ADMIN_REQUIRED');
  assert.equal(h.call({ action: 'deleteArticle', password: CLIENT, company: 'global_food', row: 3, sku: '10165' }).error.code, 'ADMIN_REQUIRED');
});

test('saveArticle: новый артикул — строка в конце листа своей компании, с площадкой и числами', () => {
  const h = loadCodeGs();
  const before = h.sheets[SV].data.length;
  const reply = h.call({ action: 'saveArticle', password: ADMIN, company: 'studio_vkusa', article: article({ layout: 'СВ_30001_1.jpg' }) });
  assert.equal(reply.ok, true);
  assert.equal(reply.row, before + 1);
  assert.deepEqual(plain(sheetRow(h, SV, reply.row)), [1, 'СВ', 30001, '80 х 120', 'Цветная', 'ЭТИКЕТКА НОВАЯ', '', 'СВ_30001_1.jpg']);
  // Каталог сразу видит новый артикул.
  const catalog = h.call({ action: 'catalog', password: CLIENT });
  assert.ok(catalog.articles.some(a => a.companyId === 'studio_vkusa' && a.sku === '30001'));
});

test('saveArticle: проверка полей, категории и повтора артикула', () => {
  const h = loadCodeGs();
  const save = over => h.call({ action: 'saveArticle', password: ADMIN, company: 'global_food', article: article(over) }).error;
  assert.equal(save({ sku: '' }).code, 'ARTICLE_INVALID');
  assert.equal(save({ sku: '30 001' }).code, 'ARTICLE_INVALID');
  assert.equal(save({ sku: 'ГФ_30001' }).code, 'ARTICLE_INVALID');
  assert.equal(save({ name: '  ' }).code, 'ARTICLE_INVALID');
  assert.match(save({ category: '99' }).message, /Категории 99 нет/);
  const twin = save({ sku: '10165' });
  assert.equal(twin.code, 'ARTICLE_DUPLICATE');
  assert.match(twin.message, /строка 3/);
  assert.equal(h.call({ action: 'saveArticle', password: ADMIN, company: 'nobody', article: article() }).error.code, 'ARTICLE_INVALID');
  // У другой компании тот же артикул можно.
  assert.equal(h.call({ action: 'saveArticle', password: ADMIN, company: 'studio_vkusa', article: article({ sku: '10165' }) }).ok, true);
});

test('saveArticle: правка строки на месте; сдвинутая строка не перезаписывается', () => {
  const h = loadCodeGs();
  sheetRow(h, GF, 4)[6] = 5000; // «Тираж» в G сайт не трогает
  const reply = h.call({ action: 'saveArticle', password: ADMIN, company: 'global_food', row: 4, originalSku: '10167', article: article({ sku: '10167', name: 'НОВОЕ ИМЯ', category: '', run: '1' }) });
  assert.equal(reply.ok, true);
  assert.deepEqual(plain(sheetRow(h, GF, 4)), ['', 'ГФ', 10167, '80 х 120', 'Цветная', 'НОВОЕ ИМЯ', 5000, '']);
  const stale = h.call({ action: 'saveArticle', password: ADMIN, company: 'global_food', row: 4, originalSku: '10165', article: article() });
  assert.equal(stale.error.code, 'ARTICLE_CHANGED');
  // Смена артикула на занятый — отказ; существующий дубль 19743 правке своей строки не мешает.
  assert.equal(h.call({ action: 'saveArticle', password: ADMIN, company: 'global_food', row: 4, originalSku: '10167', article: article({ sku: '10165' }) }).error.code, 'ARTICLE_DUPLICATE');
  const rowOf19743 = h.sheets[GF].data.findIndex(r => r[2] === '19743') + 1;
  assert.equal(h.call({ action: 'saveArticle', password: ADMIN, company: 'global_food', row: rowOf19743, originalSku: '19743', article: article({ sku: '19743' }) }).ok, true);
});

test('deleteArticle: удаляет строку, только если в ней тот же артикул', () => {
  const h = loadCodeGs();
  assert.equal(h.call({ action: 'deleteArticle', password: ADMIN, company: 'global_food', row: 3, sku: '10167' }).error.code, 'ARTICLE_CHANGED');
  assert.equal(h.call({ action: 'deleteArticle', password: ADMIN, company: 'global_food', row: 99, sku: '10165' }).error.code, 'ARTICLE_CHANGED');
  const reply = h.call({ action: 'deleteArticle', password: ADMIN, company: 'global_food', row: 3, sku: '10165' });
  assert.equal(reply.ok, true);
  assert.equal(sheetRow(h, GF, 3)[2], '10167');
  assert.ok(!h.sheets[GF].data.some(r => r[2] === '10165'));
});

// ───── Загрузка макета и статус заявки ─────

const JPG = Buffer.from('fake jpg bytes').toString('base64');
const upload = (h, over = {}) => h.call({ action: 'uploadLayout', password: ADMIN, company: 'global_food', row: 3, sku: '10165', fileName: 'макет.jpg', type: 'image/jpeg', data: JPG, ...over });

test('layoutSizePart и layoutFileName: имя по правилу, занятое — со следующей версией', () => {
  const h = loadCodeGs();
  assert.equal(h.ctx.layoutSizePart('80 х 120'), '80x120');
  assert.equal(h.ctx.layoutSizePart('40,5 × 95,6'), '40,5x95,6');
  assert.equal(h.ctx.layoutSizePart(' D80 '), 'D80');
  assert.equal(h.ctx.layoutSizePart('60_70/1'), '60701');
  assert.equal(h.ctx.layoutFileName('ГФ', '19747', '80 х 120', 'jpg', []), 'ГФ_19747_80x120.jpg');
  assert.equal(h.ctx.layoutFileName('СВ', '19392', '', 'png', []), 'СВ_19392.png');
  assert.equal(h.ctx.layoutFileName('ГФ', '10165', '80 х 120', 'jpg', ['гф_10165_80x120.JPG', 'ГФ_10165_2_80x120.jpg']), 'ГФ_10165_3_80x120.jpg');
});

test('uploadLayout: только администратору; тип, размер и строка проверяются до Диска', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  assert.equal(upload(h, { password: CLIENT }).error.code, 'ADMIN_REQUIRED');
  assert.equal(upload(h, { type: 'image/gif' }).error.code, 'LAYOUT_UPLOAD_INVALID');
  assert.equal(upload(h, { data: '' }).error.code, 'LAYOUT_UPLOAD_INVALID');
  assert.equal(upload(h, { sku: '10167' }).error.code, 'ARTICLE_CHANGED');
  assert.deepEqual(h.disk.uploads, []);
  const noToken = loadCodeGs({ props: { YANDEX_DISK_TOKEN: null } });
  assert.equal(upload(noToken).error.code, 'LAYOUTS_NOT_CONFIGURED');
});

test('uploadLayout: новый файл без токена в PUT, имя в «Макет» у всех строк артикула, старый — в корзину', () => {
  const h = loadCodeGs({ layouts: LAYOUTS, sheetOptions: { layoutColumn: true } });
  h.sheets[GF].data[2][3] = '80 х 120';
  const reply = upload(h);
  assert.equal(reply.ok, true);
  assert.equal(reply.name, 'ГФ_10165_80x120.jpg');
  assert.deepEqual(h.disk.uploads.map(u => [u.path, u.auth]), [[path('ГФ_10165_80x120.jpg'), '']]);
  assert.ok(h.disk.uploads[0].bytes > 0);
  assert.equal(sheetRow(h, GF, 3)[7], 'ГФ_10165_80x120.jpg');
  assert.deepEqual(plain(reply.trashed), ['ГФ_10165_3_80x120.jpg']);
  assert.deepEqual(h.disk.trash, [path('ГФ_10165_3_80x120.jpg')]);
  assert.deepEqual(h.disk.filesIn(DISK_ROOT).filter(n => n.includes('10165')), ['ГФ_10165_80x120.jpg']);
});

test('uploadLayout: общий артикул 15053 — имя у обеих компаний, старый общий файл в корзину', () => {
  const h = loadCodeGs({ layouts: LAYOUTS, sheetOptions: { layoutColumn: true } });
  const gfRow = h.sheets[GF].data.findIndex(r => r[2] === '15053') + 1;
  const reply = upload(h, { row: gfRow, sku: '15053', type: 'image/png' });
  assert.equal(reply.name, 'ГФ_15053.png');
  const names = [GF, SV].map(name => h.sheets[name].data.find(r => r[2] === '15053')[7]);
  assert.deepEqual(names, ['ГФ_15053.png', 'ГФ_15053.png']);
  assert.deepEqual(plain(reply.trashed), ['ГФ_15053_D35.jpg']);
});

test('uploadLayout: два старых файла по правилу — оба в корзину, остаётся новый', () => {
  const h = loadCodeGs({ layouts: LAYOUTS, sheetOptions: { layoutColumn: true } });
  const row = h.sheets[GF].data.findIndex(r => r[2] === '10350') + 1;
  const reply = upload(h, { row, sku: '10350' });
  assert.deepEqual(plain(reply.trashed).sort(), ['ГФ_10350_1.jpg', 'ГФ_10350_2.jpg']);
  assert.deepEqual(h.disk.filesIn(DISK_ROOT).filter(n => n.includes('10350')), [reply.name]);
});

test('setOrderStatus: «Отгружено» и обратно, только администратору', () => {
  const h = loadCodeGs();
  const sent = h.order([['Глобал Фуд', '10165']]);
  assert.equal(h.call({ action: 'setOrderStatus', password: CLIENT, number: sent.number, shipped: true }).error.code, 'ADMIN_REQUIRED');
  assert.equal(h.call({ action: 'setOrderStatus', password: ADMIN, number: 'nope', shipped: true }).error.code, 'INVALID_ORDER_NUMBER');
  assert.equal(h.call({ action: 'setOrderStatus', password: ADMIN, number: 'FB-9999 от 01.01.2026', shipped: true }).error.code, 'ORDER_NOT_FOUND');
  assert.equal(h.call({ action: 'setOrderStatus', password: ADMIN, number: sent.number, shipped: true }).status, 'shipped');
  assert.equal(h.rowOf(sent.number)[4], 'Отгружено');
  assert.equal(h.call({ action: 'orders', password: CLIENT }).orders[0].status, 'shipped');
  assert.equal(h.call({ action: 'setOrderStatus', password: ADMIN, number: sent.number, shipped: false }).status, '');
  assert.equal(h.rowOf(sent.number)[4], '');
});
