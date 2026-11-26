// Code.gs целиком в поддельном Apps Script: роли, удаление заявок, очередь макетов, Яндекс Диск, Telegram.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISK_ORDERS, DISK_ROOT, GF, LINES, ORDERS, SV, TEST_DISK_TOKEN, TEST_PASSWORDS,
  defaultSheets, loadCodeGs, plain, putOrder
} from './gas-harness.js';

const ADMIN = TEST_PASSWORDS.admin;
const CLIENT = TEST_PASSWORDS.client;
const LAYOUTS = ['ГФ_10165_3_80x120.jpg', 'ГФ_10338_D80.jpg', 'ГФ_10350_1.jpg', 'ГФ_10350_2.jpg'];
const gf = sku => ['Глобал Фуд', sku];
const sv = sku => ['Студия Вкуса', sku];

// ───── Роли ─────

test('catalog: роль по паролю; неверный — ACCESS_DENIED с паузой; без паролей — ACCESS_NOT_CONFIGURED', () => {
  const h = loadCodeGs();
  assert.equal(h.call({ action: 'catalog', password: CLIENT }).role, 'client');
  assert.equal(h.call({ action: 'catalog', password: ADMIN }).role, 'admin');
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.call({ action: 'catalog', password: 'wrong' }).error.code, 'ACCESS_DENIED');
  assert.deepEqual(h.sleeps, [1500]);
  assert.equal(h.call({ action: 'catalog' }).error.code, 'ACCESS_DENIED');

  const none = loadCodeGs({ props: { ACCESS_PASSWORD: null, ADMIN_PASSWORD: null } });
  assert.equal(none.call({ action: 'catalog', password: '' }).error.code, 'ACCESS_NOT_CONFIGURED');
});

test('ADMIN_PASSWORD, равный ACCESS_PASSWORD: вход как клиент, удалять нельзя', () => {
  const h = loadCodeGs({ props: { ADMIN_PASSWORD: CLIENT } });
  assert.equal(h.call({ action: 'catalog', password: CLIENT }).role, 'client');
  assert.equal(h.call({ action: 'deleteOrder', password: CLIENT, number: 'FB-0001 от 01.01.2026' }).error.code, 'ADMIN_REQUIRED');
});

test('только ADMIN_PASSWORD: админ входит, клиентского пароля нет', () => {
  const h = loadCodeGs({ props: { ACCESS_PASSWORD: null } });
  assert.equal(h.call({ action: 'catalog', password: ADMIN }).role, 'admin');
  assert.equal(h.call({ action: 'catalog', password: '' }).error.code, 'ACCESS_DENIED');
});

test('catalog: артикулы одинаковые с колонкой H «Макет» и без неё', () => {
  const without = loadCodeGs().call({ action: 'catalog', password: CLIENT });
  const withH = loadCodeGs({ sheetOptions: { layoutColumn: true, gfLayouts: { 10165: 'ГФ_10165_old.jpg' } } }).call({ action: 'catalog', password: CLIENT });
  assert.ok(without.articles.length > 10);
  assert.deepEqual(withH.articles, without.articles);
  assert.deepEqual(Object.keys(without.articles[0]).sort(), ['categoryId', 'companyId', 'name', 'sku']);
});

test('orders: клиент — как раньше, без layouts и layoutsAlert; админ — layouts из F–H и layoutsAlert', () => {
  const h = loadCodeGs();
  putOrder(h, 'FB-0001 от 09.11.2026', new Date('2026-11-09T15:10:05Z'), [gf('10165')], ['https://disk.yandex.ru/d/A', 'Не все макеты', 'ГФ 10003, ГФ 10350 — несколько файлов']);
  putOrder(h, 'FB-0002 от 09.11.2026', new Date('2026-11-09T16:00:00Z'), [gf('10338')]);
  h.sheets[ORDERS].data[2][4] = 'Отгружено';
  h.props.LAYOUT_ALERT = 'токен не принят';

  const client = h.call({ action: 'orders', password: CLIENT });
  assert.equal(client.role, 'client');
  assert.equal('layoutsAlert' in client, false);
  assert.deepEqual(client.orders.map(o => Object.keys(o).sort()), [
    ['company', 'number', 'sentAt', 'status', 'total'], ['company', 'number', 'sentAt', 'status', 'total']
  ]);
  assert.deepEqual(client.orders.map(o => [o.number, o.status]), [['FB-0002 от 09.11.2026', 'shipped'], ['FB-0001 от 09.11.2026', '']]);

  const admin = h.call({ action: 'orders', password: ADMIN });
  assert.equal(admin.role, 'admin');
  assert.equal(admin.layoutsAlert, 'токен не принят');
  assert.deepEqual(admin.orders[1].layouts, { status: 'partial', url: 'https://disk.yandex.ru/d/A', problems: ['ГФ 10003', 'ГФ 10350 — несколько файлов'] });
  assert.deepEqual(admin.orders[0].layouts, { status: '', url: '', problems: [] });
});

test('orders: старые строки без колонок F–H у админа не ломаются', () => {
  const h = loadCodeGs();
  h.sheets[ORDERS].data[0] = ['Номер', 'Дата', 'Компания', 'Итого'];
  h.sheets[ORDERS].data.push(['FB-0001 от 01.01.2026', new Date('2026-01-01T10:00:00Z'), 'Глобал Фуд', 2000]);
  const admin = h.call({ action: 'orders', password: ADMIN });
  assert.deepEqual(admin.orders[0].layouts, { status: '', url: '', problems: [] });
  assert.equal(admin.layoutsAlert, '');
});

// ───── Удаление ─────

function threeOrders(h) {
  const a = 'FB-0001 от 09.11.2026';
  const b = 'FB-0002 от 09.11.2026';
  const c = 'FB-0003 от 09.11.2026';
  putOrder(h, a, new Date('2026-11-09T10:00:00Z'), []);
  putOrder(h, b, new Date('2026-11-09T11:00:00Z'), []);
  putOrder(h, c, new Date('2026-11-09T12:00:00Z'), []);
  // Позиции вперемешку: строки B не соседние.
  const line = (n, sku) => [n, 'Глобал Фуд', sku, 'x', 1000, 'Стандартный', 2, 2000, ''];
  h.sheets[LINES].data.push(line(a, '1'), line(b, '2'), line(b, '3'), line(c, '4'), line(b, '5'), line(a, '6'), line(b, '7'));
  return { a, b, c };
}

test('deleteOrder: админ удаляет строку и все позиции заявки, остальные целы', () => {
  const h = loadCodeGs();
  const { a, b, c } = threeOrders(h);
  const reply = h.call({ action: 'deleteOrder', password: ADMIN, number: b });
  assert.deepEqual(reply, { ok: true, number: b, deletedLines: 4 });
  assert.deepEqual(h.orderRows().map(r => r[0]), [a, c]);
  assert.deepEqual(h.lineRows().map(r => [r[0], r[2]]), [[a, '1'], [c, '4'], [a, '6']]);
  assert.equal(h.disk.requests.length, 0, 'удаление не ходит на Диск');
  assert.equal(h.telegram.length, 0, 'удаление не шлёт сообщений');
});

test('deleteOrder: коды ошибок, ничего не удаляется', () => {
  const h = loadCodeGs();
  const { b } = threeOrders(h);
  const before = JSON.stringify([h.orderRows(), h.lineRows()]);
  assert.equal(h.call({ action: 'deleteOrder', password: CLIENT, number: b }).error.code, 'ADMIN_REQUIRED');
  assert.equal(h.call({ action: 'deleteOrder', password: ADMIN, number: 'x' }).error.code, 'INVALID_ORDER_NUMBER');
  assert.equal(h.call({ action: 'deleteOrder', password: ADMIN }).error.code, 'INVALID_ORDER_NUMBER');
  assert.equal(h.call({ action: 'deleteOrder', password: ADMIN, number: 'FB-0099 от 09.11.2026' }).error.code, 'ORDER_NOT_FOUND');
  assert.equal(h.call({ action: 'deleteOrder', password: 'wrong', number: b }).error.code, 'ACCESS_DENIED');
  h.locks.scriptWaitThrows = true;
  assert.equal(h.call({ action: 'deleteOrder', password: ADMIN, number: b }).error.code, 'ORDER_DELETE_FAILED');
  assert.equal(JSON.stringify([h.orderRows(), h.lineRows()]), before);
});

test('deleteOrder: второй раз — ORDER_NOT_FOUND; номер последней заявки выдаётся снова без старых позиций', () => {
  const h = loadCodeGs();
  const first = h.order([gf('10165'), gf('10338')]);
  const second = h.order([gf('10350')]);
  assert.equal(h.call({ action: 'deleteOrder', password: ADMIN, number: second.number }).deletedLines, 1);
  assert.equal(h.call({ action: 'deleteOrder', password: ADMIN, number: second.number }).error.code, 'ORDER_NOT_FOUND');
  const again = h.order([gf('19455')]);
  assert.equal(again.number, second.number);
  assert.deepEqual(h.call({ action: 'orderLines', password: CLIENT, number: again.number }).lines.map(l => l.sku), ['19455']);
  assert.equal(h.call({ action: 'orderLines', password: CLIENT, number: first.number }).lines.length, 2);
});

test('deleteOrder забывает попытки и пометку «заново» этой заявки', () => {
  const h = loadCodeGs();
  const { b } = threeOrders(h);
  h.props.LAYOUT_ATTEMPTS = JSON.stringify({ [b]: 2, other: 1 });
  h.props.LAYOUT_FRESH = JSON.stringify([b]);
  h.call({ action: 'deleteOrder', password: ADMIN, number: b });
  assert.deepEqual(JSON.parse(h.props.LAYOUT_ATTEMPTS), { other: 1 });
  assert.equal(h.props.LAYOUT_FRESH, undefined);
});

// ───── Очередь макетов ─────

test('order с токеном: «В очереди» и один разовый триггер; второй заказ триггер не добавляет', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165')]);
  assert.equal(sent.ok, true);
  assert.deepEqual(Object.keys(sent).sort(), ['number', 'ok']);
  assert.deepEqual(h.layoutCells(sent.number), { url: '', status: 'В очереди', problems: '' });
  assert.equal(h.triggers.length, 1);
  assert.equal(h.triggers[0].getHandlerFunction(), 'buildPendingLayouts');
  assert.ok(h.triggers[0].spec.after > 0);
  assert.equal(h.props.LAYOUT_TRIGGER_ID, h.triggers[0].getUniqueId());
  h.order([gf('10338')]);
  assert.equal(h.triggers.length, 1);
  assert.equal(h.disk.requests.length, 0, 'заявка сама на Диск не ходит');
});

test('order без токена: F–H пустые, триггера нет, Диск не трогается', () => {
  const h = loadCodeGs({ props: { YANDEX_DISK_TOKEN: null } });
  const sent = h.order([gf('10165')]);
  assert.equal(sent.ok, true);
  assert.deepEqual(h.rowOf(sent.number).slice(5).filter(v => v !== ''), []);
  assert.equal(h.triggers.length, 0);
  assert.equal(h.disk.requests.length, 0);
  assert.equal(h.runQueue().processed.length, 0);
});

test('сборка: найдено + нет + конфликт → папка, копии, публикация, F–H, Telegram', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165'), gf('10338'), gf('10350'), gf('10003'), gf('10165')]);
  const run = plain(h.ctx.buildPendingLayouts({ triggerUid: h.props.LAYOUT_TRIGGER_ID }));
  assert.deepEqual(run, { processed: [sent.number], remaining: 0, stopped: '' });

  const folders = h.disk.dirsIn(DISK_ORDERS);
  assert.equal(folders.length, 1);
  assert.match(folders[0], new RegExp(`^${DISK_ORDERS}/${sent.number} \\d\\d\\.\\d\\d\\.\\d\\d$`));
  assert.deepEqual(h.disk.filesIn(folders[0]), ['ГФ_10165_3_80x120.jpg', 'ГФ_10338_D80.jpg']);
  const copies = h.disk.copies();
  assert.equal(copies.length, 2);
  copies.forEach(copy => {
    assert.equal(copy.query.overwrite, 'true');
    assert.ok(copy.query.from.startsWith(`${DISK_ROOT}/`));
  });
  assert.deepEqual(h.disk.published, [folders[0]]);

  const cells = h.layoutCells(sent.number);
  assert.equal(cells.status, 'Не все макеты');
  assert.equal(cells.url, 'https://disk.yandex.ru/d/pub1');
  assert.equal(cells.problems, 'ГФ 10350 — несколько файлов, ГФ 10003');

  const messages = h.layoutMessages();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /https:\/\/disk\.yandex\.ru\/d\/pub1/);
  assert.match(messages[0], /2 из 4 арт\./);
  assert.match(messages[0], /Нет макета: ГФ 10003/);
  assert.match(messages[0], /ГФ 10350 \(ГФ_10350_1\.jpg, ГФ_10350_2\.jpg\)/);
  assert.equal(h.triggers.length, 0, 'разовый триггер удалён');
  assert.equal(h.props.LAYOUT_TRIGGER_ID, undefined);

  const admin = h.call({ action: 'orders', password: ADMIN });
  assert.deepEqual(admin.orders[0].layouts, { status: 'partial', url: 'https://disk.yandex.ru/d/pub1', problems: ['ГФ 10350 — несколько файлов', 'ГФ 10003'] });
});

test('общие артикулы 15053/18507/19455: буквы в имени не важны, макет один и копируется один раз', () => {
  const h = loadCodeGs({ layouts: ['ГФ_15053_a.jpg', 'СВ_18507_1.jpg', 'ГФ_19455_x.jpg'] });
  const sent = h.order([gf('15053'), sv('15053'), gf('18507'), sv('18507'), sv('19455'), gf('10003')]);
  h.runQueue();
  const folder = h.disk.dirsIn(DISK_ORDERS)[0];
  assert.deepEqual(h.disk.filesIn(folder).sort(), ['ГФ_15053_a.jpg', 'ГФ_19455_x.jpg', 'СВ_18507_1.jpg'].sort());
  assert.equal(h.disk.copies().length, 3);
  assert.equal(h.layoutCells(sent.number).problems, 'ГФ 10003');
});

test('одна папка на заявку: макеты обеих компаний лежат рядом, без подпапок', () => {
  const h = loadCodeGs({ layouts: ['ГФ_10165_3_80x120.jpg', 'ГФ_20001_1.jpg'] });
  h.order([gf('10165'), sv('20001')]);
  h.runQueue();
  const folders = h.disk.dirsIn(DISK_ORDERS);
  assert.equal(folders.length, 1);
  assert.deepEqual(h.disk.filesIn(folders[0]).sort(), ['ГФ_10165_3_80x120.jpg', 'ГФ_20001_1.jpg']);
  assert.deepEqual(h.disk.dirsIn(folders[0]), []);
});

test('колонка H «Макет» побеждает правило имени', () => {
  const h = loadCodeGs({
    layouts: ['ГФ_10165_3_80x120.jpg', 'ГФ_10165_old.jpg'],
    sheetOptions: { layoutColumn: true, gfLayouts: { 10165: 'ГФ_10165_old.jpg' } }
  });
  const sent = h.order([gf('10165')]);
  h.runQueue();
  assert.deepEqual(h.disk.copies().map(c => c.query.from), [`${DISK_ROOT}/ГФ_10165_old.jpg`]);
  assert.equal(h.layoutCells(sent.number).status, 'Готово');
});

test('колонка H с файлом, которого нет — проблема, правило не подставляется', () => {
  const h = loadCodeGs({
    layouts: ['ГФ_10165_3_80x120.jpg', 'СВ_15053_a.jpg'],
    sheetOptions: { layoutColumn: true, svLayouts: { 15053: 'СВ_15053_x.jpg' } }
  });
  const sent = h.order([gf('10165'), sv('15053')]);
  h.runQueue();
  assert.deepEqual(h.disk.copies().map(c => c.query.from.split('/').pop()), ['ГФ_10165_3_80x120.jpg']);
  assert.equal(h.layoutCells(sent.number).problems, 'СВ 15053 — нет файла «СВ_15053_x.jpg»');
});

test('все найдены → «Готово», H пусто; ни одного → «Макетов нет», без папки', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const all = h.order([gf('10165'), gf('10338')]);
  const none = h.order([gf('10003'), gf('10347')]);
  h.runQueue();
  assert.deepEqual(h.layoutCells(all.number), { url: 'https://disk.yandex.ru/d/pub1', status: 'Готово', problems: '' });
  assert.deepEqual(h.layoutCells(none.number), { url: '', status: 'Макетов нет', problems: 'ГФ 10003, ГФ 10347' });
  assert.equal(h.disk.dirsIn(DISK_ORDERS).length, 1);
  const messages = h.layoutMessages();
  assert.equal(messages.length, 2);
  assert.match(messages[0], /2 файла/);
  assert.match(messages[1], /ни одного файла/);
});

test('202: копирование через операцию — опрос до success, файл засчитан', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  h.disk.asyncCopy = from => from.endsWith('ГФ_10338_D80.jpg');
  h.disk.opPollsBeforeSuccess = 2;
  const sent = h.order([gf('10165'), gf('10338')]);
  h.runQueue();
  const polls = h.disk.requests.filter(r => r.kind === 'operation');
  assert.equal(polls.length, 3);
  assert.ok(h.sleeps.includes(1000));
  assert.equal(h.layoutCells(sent.number).status, 'Готово');
  assert.match(h.layoutMessages()[0], /2 файла/);
});

test('операция копирования на чужом адресе — ошибка, токен туда не уходит', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const original = h.disk.handle;
  h.disk.handle = (url, options) => {
    if (url.includes('/resources/copy')) {
      original(url, options);
      return { getResponseCode: () => 202, getContentText: () => JSON.stringify({ href: 'https://evil.example/op/1' }) };
    }
    return original(url, options);
  };
  const sent = h.order([gf('10165')]);
  h.runQueue();
  assert.ok(h.fetchLog.every(r => !r.url.includes('evil.example')));
  assert.equal(h.layoutCells(sent.number).status, 'Ошибка');
});

test('список макетов постранично: все страницы прочитаны', () => {
  const names = Array.from({ length: 25 }, (_, i) => `ГФ_${20000 + i}_x.jpg`).concat(['ГФ_10165_3_80x120.jpg']);
  const h = loadCodeGs({ layouts: names });
  h.disk.pageLimit = 10;
  const sent = h.order([gf('10165')]);
  h.runQueue();
  assert.equal(h.disk.requests.filter(r => r.kind === 'list' && r.query.path === DISK_ROOT).length, 3);
  assert.equal(h.layoutCells(sent.number).status, 'Готово');
});

test('401: заявка остаётся в очереди, LAYOUT_ALERT, одно сообщение о токене на несколько запусков', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165')]);
  const triggersBefore = h.triggers.length;
  h.disk.validToken = 'rotated-token';

  const first = h.runQueue();
  assert.equal(first.stopped, 'auth');
  assert.deepEqual(first.processed, []);
  assert.equal(h.layoutCells(sent.number).status, 'В очереди');
  assert.match(h.props.LAYOUT_ALERT, /токен/);
  const second = h.runQueue();
  assert.equal(second.stopped, 'auth');
  assert.equal(h.layoutCells(sent.number).status, 'В очереди');

  const tokenMessages = h.layoutMessages().filter(text => /YANDEX_DISK_TOKEN/.test(text));
  assert.equal(tokenMessages.length, 1);
  assert.equal(h.layoutMessages().length, 1);
  assert.equal(h.triggers.length, triggersBefore, 'новых разовых триггеров нет');
  assert.equal(h.props.LAYOUT_ATTEMPTS, undefined, '401 не тратит попытки');
  assert.match(h.call({ action: 'orders', password: ADMIN }).layoutsAlert, /YANDEX_DISK_TOKEN/);

  // Через 12 часов — напоминание снова.
  h.props.LAYOUT_ALERT_SENT_AT = String(Date.now() - 13 * 3600e3);
  h.runQueue();
  assert.equal(h.layoutMessages().filter(text => /YANDEX_DISK_TOKEN/.test(text)).length, 2);

  // Новый токен: очередь собирается, предупреждение пропадает.
  h.disk.validToken = TEST_DISK_TOKEN;
  const fixed = h.runQueue();
  assert.deepEqual(fixed.processed, [sent.number]);
  assert.equal(h.props.LAYOUT_ALERT, undefined);
  assert.equal(h.call({ action: 'orders', password: ADMIN }).layoutsAlert, '');
});

test('500 при создании папки: попытки растут, на третьей — «Ошибка» и сообщение', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165')]);
  h.disk.fail = req => (req.kind === 'mkdir' ? 500 : null);
  h.runQueue();
  assert.equal(h.layoutCells(sent.number).status, 'В очереди');
  assert.deepEqual(JSON.parse(h.props.LAYOUT_ATTEMPTS), { [sent.number]: 1 });
  h.runQueue();
  assert.deepEqual(JSON.parse(h.props.LAYOUT_ATTEMPTS), { [sent.number]: 2 });
  assert.equal(h.layoutMessages().length, 0);
  h.runQueue();
  assert.equal(h.layoutCells(sent.number).status, 'Ошибка');
  assert.equal(h.props.LAYOUT_ATTEMPTS, undefined);
  const messages = h.layoutMessages();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /не собраны/);
});

test('500 на копировании одного файла: один повтор, потом проблема «не скопировал»', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165'), gf('10338')]);
  h.disk.fail = req => (req.kind === 'copy' && req.query.from.endsWith('ГФ_10338_D80.jpg') ? 500 : null);
  h.runQueue();
  assert.equal(h.disk.copies().filter(c => c.query.from.endsWith('ГФ_10338_D80.jpg')).length, 2);
  assert.ok(h.sleeps.includes(2000));
  const cells = h.layoutCells(sent.number);
  assert.equal(cells.status, 'Не все макеты');
  assert.match(cells.problems, /ГФ 10338 — Яндекс Диск не скопировал файл \(500\)/);
});

test('срок запуска уже вышел: ничего не собрано, запуск перенесён', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165')]);
  const run = h.runQueue({ deadline: Date.now() });
  assert.equal(run.stopped, 'deadline');
  assert.equal(h.disk.requests.length, 0);
  assert.equal(h.layoutCells(sent.number).status, 'В очереди');
  assert.ok(h.triggers.some(t => t.getUniqueId() === h.props.LAYOUT_TRIGGER_ID));
});

test('«Собирается» от оборванного запуска: возвращается в очередь и собирается', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165')]);
  h.sheets[ORDERS].data[1][6] = 'Собирается';
  const run = h.runQueue();
  assert.deepEqual(run.processed, [sent.number]);
  assert.equal(h.layoutCells(sent.number).status, 'Готово');
});

test('документная блокировка занята — stopped: busy, ничего не трогается', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165')]);
  h.locks.documentTryLock = false;
  assert.equal(h.runQueue().stopped, 'busy');
  assert.equal(h.layoutCells(sent.number).status, 'В очереди');
  assert.equal(h.disk.requests.length, 0);
});

test('папка заявок внутри папки макетов — «Ошибка» и одно сообщение', () => {
  const h = loadCodeGs({ layouts: LAYOUTS, props: { LAYOUTS_ORDERS_ROOT: `${DISK_ROOT}/Заявки` } });
  const sent = h.order([gf('10165')]);
  assert.equal(h.runQueue().stopped, 'config');
  assert.equal(h.layoutCells(sent.number).status, 'Ошибка');
  assert.equal(h.layoutMessages().length, 1);
  assert.equal(h.disk.requests.length, 0);
});

test('buildPendingLayouts удаляет только свой разовый триггер, ежечасный остаётся', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  h.order([gf('10165')]);
  h.ctx.setupLayouts();
  assert.equal(h.triggers.length, 2);
  const hourly = h.triggers.find(t => t.spec.everyHours === 1);
  assert.ok(hourly);
  h.ctx.buildPendingLayouts({ triggerUid: h.props.LAYOUT_TRIGGER_ID });
  assert.deepEqual(h.triggers.map(t => t.getUniqueId()), [hourly.getUniqueId()]);
  // Запуск ежечасным триггером его не удаляет.
  h.ctx.buildPendingLayouts({ triggerUid: hourly.getUniqueId() });
  assert.equal(h.triggers.length, 1);
  // setupLayouts повторно второй ежечасный не ставит.
  h.ctx.setupLayouts();
  assert.equal(h.triggers.filter(t => t.spec.everyHours).length, 1);
  assert.ok(h.disk.nodes.has(DISK_ORDERS));
});

test('номер выдан повторно: сборка старой заявки не пишет в новую строку', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const number = 'FB-0001 от 09.11.2026';
  putOrder(h, number, new Date('2026-11-09T15:10:05Z'), [gf('10165')], ['', 'В очереди', '']);
  let replaced = false;
  h.disk.onCopy = () => {
    if (replaced) return;
    replaced = true;
    // Пока старая собирается, админ её удаляет, и клиент получает тот же номер.
    assert.equal(h.call({ action: 'deleteOrder', password: ADMIN, number }).ok, true);
    putOrder(h, number, new Date('2026-11-09T16:20:30Z'), [gf('10338'), gf('10003')], ['', 'В очереди', '']);
  };
  const run = h.runQueue();
  assert.deepEqual(run.processed, [number]);
  assert.equal(h.orderRows().length, 1);
  const cells = h.layoutCells(number);
  assert.equal(cells.status, 'Не все макеты');
  assert.equal(cells.problems, 'ГФ 10003');
  const folders = h.disk.dirsIn(DISK_ORDERS).map(p => p.split('/').pop()).sort();
  assert.deepEqual(folders, [`${number} 18.10.05`, `${number} 19.20.30`]);
  assert.equal(cells.url, h.disk.nodes.get(`${DISK_ORDERS}/${number} 19.20.30`).publicUrl);
  assert.deepEqual(h.disk.filesIn(`${DISK_ORDERS}/${number} 19.20.30`), ['ГФ_10338_D80.jpg']);
  assert.equal(h.layoutMessages().length, 1, 'об удалённой заявке сообщений нет');
});

// ───── Пересобрать папку ─────

test('rebuildLayouts: админ → queued, ссылка остаётся, файлы копируются заново', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165')]);
  h.runQueue();
  const url = h.layoutCells(sent.number).url;
  const reply = h.call({ action: 'rebuildLayouts', password: ADMIN, number: sent.number });
  assert.deepEqual(reply, { ok: true, number: sent.number, layouts: { status: 'queued', url, problems: [] } });
  assert.deepEqual(h.layoutCells(sent.number), { url, status: 'В очереди', problems: '' });
  assert.ok(h.triggers.length >= 1);
  const copiesBefore = h.disk.copies().length;
  h.runQueue();
  assert.equal(h.disk.copies().length, copiesBefore + 1, 'fresh: файл копируется заново');
  assert.equal(h.layoutCells(sent.number).status, 'Готово');
  assert.equal(h.props.LAYOUT_FRESH, undefined);
});

test('rebuildLayouts: ошибки ADMIN_REQUIRED, INVALID_ORDER_NUMBER, ORDER_NOT_FOUND, LAYOUTS_NOT_CONFIGURED', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([gf('10165')]);
  assert.equal(h.call({ action: 'rebuildLayouts', password: CLIENT, number: sent.number }).error.code, 'ADMIN_REQUIRED');
  assert.equal(h.call({ action: 'rebuildLayouts', password: ADMIN, number: 'abc' }).error.code, 'INVALID_ORDER_NUMBER');
  assert.equal(h.call({ action: 'rebuildLayouts', password: ADMIN, number: 'FB-0099 от 01.01.2026' }).error.code, 'ORDER_NOT_FOUND');
  const off = loadCodeGs({ props: { YANDEX_DISK_TOKEN: null } });
  const offSent = off.order([gf('10165')]);
  assert.equal(off.call({ action: 'rebuildLayouts', password: ADMIN, number: offSent.number }).error.code, 'LAYOUTS_NOT_CONFIGURED');
  assert.equal(h.call({ action: 'nope', password: ADMIN }).error.code, 'UNKNOWN_ACTION');
});

test('меню: onOpen добавляет пункты; пересборка выделенной строки', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  h.ctx.onOpen();
  assert.equal(h.ui.menus.length, 1);
  assert.deepEqual(h.ui.menus[0].items.map(item => item[1]), ['rebuildLayoutsForSelectedRow', 'buildLayoutsNow']);
  const sent = h.order([gf('10165')]);
  h.runQueue();
  h.setActiveSheet(GF, 3);
  h.ctx.rebuildLayoutsForSelectedRow();
  assert.match(h.ui.alerts.pop(), /Заявки/);
  h.setActiveSheet(ORDERS, 2);
  h.ctx.rebuildLayoutsForSelectedRow();
  assert.match(h.ui.alerts.pop(), /Собрано заявок: 1/);
  assert.equal(h.layoutCells(sent.number).status, 'Готово');
  assert.equal(h.disk.copies().length, 2);
});

// ───── fillLayoutColumn ─────

const FILL_FILES = ['ГФ_10165_3_80x120.jpg', 'ГФ_19743_1.jpg', 'ГФ_10350_1.jpg', 'ГФ_10350_2.jpg', 'ГФ_15053_a.jpg', 'ГФ_10338_D80.jpg', 'СВ_99999_x.jpg', 'readme.txt'];

const columnH = (h, name) => h.sheets[name].data.slice(2).map(row => [row[2], row[7] ?? '']);

test('fillLayoutColumn: создаёт заголовок H2 и заполняет пустые ячейки; 19743 дважды', () => {
  const h = loadCodeGs({ layouts: FILL_FILES });
  const result = plain(h.ctx.fillLayoutColumn());
  assert.equal(h.sheets[GF].data[1][7], 'Макет');
  assert.equal(h.sheets[SV].data[1][7], 'Макет');
  const gfH = Object.fromEntries(columnH(h, GF).map(([sku, v], i) => [`${sku}#${i}`, v]));
  assert.equal(gfH['10165#0'], 'ГФ_10165_3_80x120.jpg');
  assert.equal(gfH['10338#3'], 'ГФ_10338_D80.jpg');
  assert.equal(gfH['10350#5'], '', 'конфликт — пусто');
  assert.equal(gfH['15053#7'], 'ГФ_15053_a.jpg');
  assert.equal(gfH['19743#10'], 'ГФ_19743_1.jpg');
  assert.equal(gfH['19743#11'], 'ГФ_19743_1.jpg');
  // Общий артикул: у Студии Вкуса тот же файл, хоть он и назван «ГФ_…».
  assert.deepEqual(columnH(h, SV).find(([sku]) => sku === '15053'), ['15053', 'ГФ_15053_a.jpg']);
  assert.equal(result.filled, 6);
  assert.deepEqual(result.conflicts, [{ label: 'ГФ 10350', files: ['ГФ_10350_1.jpg', 'ГФ_10350_2.jpg'] }]);
  assert.ok(result.missing.includes('ГФ 10003'));
  assert.deepEqual(result.unusedFiles.sort(), ['readme.txt', 'СВ_99999_x.jpg'].sort());
  assert.ok(h.logs.log.some(line => /Заполнено ячеек «Макет»: 6/.test(line)));
  assert.ok(h.logs.log.some(line => /ГФ 10350: ГФ_10350_1\.jpg, ГФ_10350_2\.jpg/.test(line)));
  // Остальные колонки листа не тронуты.
  assert.deepEqual(h.sheets[GF].data.slice(2).map(r => r.slice(0, 7)), defaultSheets()[GF].data.slice(2).map(r => r.slice(0, 7)));
});

test('fillLayoutColumn никогда не перезаписывает ручные значения; повторный запуск ничего не меняет', () => {
  const h = loadCodeGs({
    layouts: FILL_FILES,
    sheetOptions: { layoutColumn: true, gfLayouts: { 10165: 'ГФ_10165_old.jpg', 10338: 'ГФ_10338_D80.jpg' } }
  });
  const result = plain(h.ctx.fillLayoutColumn());
  const gfH = columnH(h, GF);
  assert.equal(gfH[0][1], 'ГФ_10165_old.jpg');
  assert.equal(gfH[3][1], 'ГФ_10338_D80.jpg');
  assert.deepEqual(result.notFound, [{ label: 'ГФ 10165', value: 'ГФ_10165_old.jpg' }]);
  assert.equal(result.filled, 4);
  const snapshot = JSON.stringify([h.sheets[GF].data, h.sheets[SV].data]);
  assert.equal(plain(h.ctx.fillLayoutColumn()).filled, 0);
  assert.equal(JSON.stringify([h.sheets[GF].data, h.sheets[SV].data]), snapshot);
});

test('fillLayoutColumn: в H2 чужой заголовок — лист не трогается', () => {
  const h = loadCodeGs({ layouts: FILL_FILES });
  h.sheets[GF].data[1][7] = 'Комментарий';
  const result = plain(h.ctx.fillLayoutColumn());
  assert.deepEqual(h.sheets[GF].ops, [], 'на лист ГФ ничего не записано');
  assert.equal(h.sheets[GF].data[1][7], 'Комментарий');
  assert.ok(h.logs.error.some(line => /Комментарий/.test(line)));
  assert.equal(h.sheets[SV].data[1][7], 'Макет');
  assert.ok(result.filled >= 1);
});

test('fillLayoutColumn без токена — только заголовок, на Диск не ходит', () => {
  const h = loadCodeGs({ props: { YANDEX_DISK_TOKEN: null } });
  assert.equal(h.ctx.fillLayoutColumn(), null);
  assert.equal(h.disk.requests.length, 0);
});

test('orderLines: размер из каталога пишется в колонку J и приходит с позициями; у старых заявок — из каталога', () => {
  const h = loadCodeGs();
  const sent = h.order([['Глобал Фуд', '10165'], ['Студия Вкуса', '20001']]);
  assert.equal(h.sheets['Позиции заявок'].data[0][9], 'Размер');
  assert.deepEqual(h.lineRows().map(row => row[9]), ['80x120', '80x120']);
  const lines = h.call({ action: 'orderLines', password: CLIENT, number: sent.number }).lines;
  assert.deepEqual(lines.map(line => line.size), ['80x120', '80x120']);

  // Заявка, записанная до колонки «Размер»: J пуста — размер из каталога; артикула в каталоге нет — пусто.
  h.lineRows().forEach(row => { row[9] = ''; });
  h.lineRows()[1][2] = '99999';
  const old = h.call({ action: 'orderLines', password: CLIENT, number: sent.number }).lines;
  assert.deepEqual(old.map(line => line.size), ['80x120', '']);
});
