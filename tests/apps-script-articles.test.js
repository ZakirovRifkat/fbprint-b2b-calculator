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
  // Старый дубль 19743: строку без категории сохранить можно, вторую строку с категорией — нет (сломала бы каталог).
  const rows19743 = h.sheets[GF].data.map((r, i) => (r[2] === '19743' ? i + 1 : 0)).filter(Boolean);
  const save19743 = (row, category) => h.call({ action: 'saveArticle', password: ADMIN, company: 'global_food', row, originalSku: '19743', article: article({ sku: '19743', category }) });
  assert.equal(save19743(rows19743[1], '').ok, true);
  assert.equal(save19743(rows19743[0], '1').ok, true);
  const twin = save19743(rows19743[1], '1').error;
  assert.equal(twin.code, 'ARTICLE_DUPLICATE');
  assert.match(twin.message, new RegExp(`строка ${rows19743[0]}`));
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

// ───── Письмо заказчику ─────

const XLSX = Buffer.from('PK\u0003\u0004 fake xlsx').toString('base64');
const SHIP = '2026-11-27'; // пятница

// Две заявки одного дня с готовыми папками; в папке первой — 11 файлов, второй — 1.
function emailSetup() {
  const h = loadCodeGs();
  const first = h.order([['Глобал Фуд', '10165']]);
  const second = h.order([['Студия Вкуса', '15053']]);
  [[first, 'https://yadi.sk/d/first', 11], [second, 'https://yadi.sk/d/second', 1]].forEach(([sent, url, count]) => {
    const row = h.rowOf(sent.number);
    row[5] = url;
    const folder = `${DISK_ORDERS}/${h.ctx.orderFolderName(sent.number, h.fakes.Utilities.formatDate(row[1], 'Europe/Moscow', 'HH.mm.ss'))}`;
    h.disk.addDir(folder);
    for (let i = 1; i <= count; i++) h.disk.addFile(`${folder}/ГФ_${i}.jpg`);
  });
  const send = (over = {}) => h.call({
    action: 'sendCustomerEmail', password: ADMIN, numbers: [first.number, second.number], shipDate: SHIP, greeting: 'Светлана',
    files: { [first.number]: XLSX, [second.number]: XLSX }, ...over
  });
  return { h, first, second, send };
}

test('orderNumbersPhrase и тема: первый номер с «FB-», остальные цифрами, заявки одного дня вместе', () => {
  const h = loadCodeGs();
  const c = h.ctx;
  const n = (num, date = '24.11.2026') => `FB-${num} от ${date}`;
  assert.equal(c.orderNumbersPhrase([n('0022')]), 'FB-0022 от 24.11.2026');
  assert.equal(c.orderNumbersPhrase([n('0022'), n('0023')]), 'FB-0022 и 0023 от 24.11.2026');
  assert.equal(c.orderNumbersPhrase([n('0022'), n('0023'), n('0024')]), 'FB-0022, 0023 и 0024 от 24.11.2026');
  assert.equal(c.orderNumbersPhrase([n('0021', '23.11.2026'), n('0022'), n('0023')]), 'FB-0021 от 23.11.2026 и 0022 и 0023 от 24.11.2026');
  assert.equal(c.customerEmailSubject([n('0022'), n('0023'), n('0024')]), 'Заявки_FB-0022, 0023, 0024_от_24.11.26');
  assert.equal(c.customerEmailSubject([n('0022')]), 'Заявка_FB-0022_от_24.11.26');
  assert.equal(c.customerEmailSubject([n('0021', '23.11.2026'), n('0022')]), 'Заявки_FB-0021, 0022_от_23.11.26, 24.11.26');
});

test('shipDateText: «27/11 (пятница)», неверная дата — пусто', () => {
  const c = loadCodeGs().ctx;
  assert.equal(c.shipDateText('2026-11-27'), '27/11 (пятница)');
  assert.equal(c.shipDateText('2026-11-30'), '30/11 (понедельник)');
  assert.equal(c.shipDateText('2026-02-30'), '');
  assert.equal(c.shipDateText('27.11.2026'), '');
  assert.equal(c.shipDateText(''), '');
});

test('sendCustomerEmail: только администратору; номера, дата, обращение и таблицы проверяются до отправки', () => {
  const { h, first, second, send } = emailSetup();
  assert.equal(send({ password: CLIENT }).error.code, 'ADMIN_REQUIRED');
  assert.equal(send({ numbers: [] }).error.code, 'EMAIL_INVALID');
  assert.equal(send({ numbers: 'FB-0001' }).error.code, 'EMAIL_INVALID');
  assert.equal(send({ numbers: ['nope'] }).error.code, 'EMAIL_INVALID');
  assert.equal(send({ numbers: Array.from({ length: 21 }, (_, i) => `FB-${i}`) }).error.code, 'EMAIL_INVALID');
  assert.equal(send({ shipDate: '' }).error.message, 'Укажите плановую дату отгрузки');
  assert.equal(send({ shipDate: '2026-13-01' }).error.code, 'EMAIL_INVALID');
  assert.equal(send({ greeting: '  ' }).error.message, 'Укажите, к кому обращаемся в письме');
  assert.equal(send({ files: { [first.number]: XLSX } }).error.message, `Не приложилась таблица заявки: ${second.number}`);
  assert.equal(send({ files: { [first.number]: XLSX, [second.number]: Buffer.from('not zip').toString('base64') } }).error.code, 'EMAIL_INVALID');
  const missing = send({ numbers: [first.number, 'FB-9999 от 01.01.2026'], files: { [first.number]: XLSX, 'FB-9999 от 01.01.2026': XLSX } });
  assert.equal(missing.error.code, 'ORDER_NOT_FOUND');
  assert.match(missing.error.message, /FB-9999 от 01\.01\.2026/);
  h.rowOf(second.number)[5] = '';
  assert.equal(send().error.message, `Папка макетов ещё не готова: ${second.number}`);
  assert.equal(h.mail.length, 0);
});

test('sendCustomerEmail: письмо по шаблону менеджера, таблицы заявок во вложении, файлы посчитаны в папках', () => {
  const { h, first, second, send } = emailSetup();
  const reply = send({ numbers: [first.number, second.number, first.number] });
  assert.equal(reply.ok, true);
  assert.equal(reply.to, 'info@fb-print.ru');
  assert.deepEqual(plain(reply.numbers), [first.number, second.number]);
  assert.equal(h.mail.length, 1);
  const [letter] = h.mail;
  const [a, b] = [first.number, second.number].map(number => h.ctx.orderNumberParts(number));
  assert.equal(letter.to, 'info@fb-print.ru');
  assert.equal(letter.name, 'FB-print');
  assert.equal(letter.subject, `Заявки_${a.short}, ${b.digits}_от_${a.date.slice(0, 6)}${a.date.slice(8)}`);
  assert.equal(letter.body, [
    'Светлана,',
    '',
    `Получены заявки ${a.short} и ${b.digits} от ${a.date} (во вложении).`,
    'Заказ подтверждаю. Плановая дата отгрузки 27/11 (пятница).',
    '',
    `Макеты к заявке ${first.number}: 11 файлов.`,
    'https://yadi.sk/d/first',
    '',
    `Макеты к заявке ${second.number}: 1 файл.`,
    'https://yadi.sk/d/second'
  ].join('\n'));
  assert.match(letter.htmlBody, /<a href="https:\/\/yadi\.sk\/d\/first">https:\/\/yadi\.sk\/d\/first<\/a>/);
  assert.deepEqual(plain(letter.attachments.map(file => file.getName())), [`${first.number}.xlsx`, `${second.number}.xlsx`]);
  assert.equal(letter.attachments[0].getContentType(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('sendCustomerEmail: папку не посчитать — строка без числа файлов; одна заявка; лимит и сбой почты', () => {
  const { h, first, send } = emailSetup();
  h.disk.fail = req => (req.kind === 'list' ? 503 : null);
  assert.equal(send({ numbers: [first.number], greeting: 'Иван <Петрович>' }).ok, true);
  const [letter] = h.mail;
  assert.match(letter.subject, /^Заявка_FB-\d+_от_/);
  assert.match(letter.body, /^Иван <Петрович>,\n\nПолучена заявка FB-\d+ от [\d.]+ \(во вложении\)\./);
  assert.match(letter.body, new RegExp(`Макеты к заявке ${first.number}:\nhttps://yadi.sk/d/first$`));
  assert.match(letter.htmlBody, /^<p>Иван &lt;Петрович&gt;,<\/p>/);

  h.mailState.quota = 0;
  const quota = send();
  assert.equal(quota.error.code, 'EMAIL_SEND_FAILED');
  assert.match(quota.error.message, /лимит писем/);

  h.mailState.quota = 10;
  h.mailState.fail = 'Service invoked too many times';
  assert.equal(send().error.message, 'Письмо не отправлено: Service invoked too many times');
  assert.equal(h.mail.length, 1);
});
