// js/admin.js: роль, вид папки макетов, ответы на удаление, запросы и полоса администратора.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/state.js';
import {
  LAYOUTS_REFRESH_MS, adminBar, adminErrorText, deleteOrderButton, deleteOrderRequest, deleteOutcome, hasPendingLayouts, isAdmin,
  layoutsView, needsLayoutsRefresh, postAction, problemsText, rebuildLabel, rebuildLayoutsRequest, roleOf
} from '../js/admin.js';
import { forgetPassword } from '../js/auth.js';
import { memoryStorage, setStorage } from './helpers.js';
import { installFakeDocument } from './fake-dom.js';

installFakeDocument();
const API = 'https://script.example.test/exec';
let requests;

function stubFetch(reply) {
  requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return { json: async () => (typeof reply === 'function' ? reply() : reply) };
  };
}

beforeEach(() => {
  globalThis.window = { FBPRINT_CONFIG: { apiUrl: API, requestTimeoutMs: 5000 } };
  setStorage('localStorage', memoryStorage());
  setStorage('sessionStorage', memoryStorage());
  state.sessionPassword = 'admin-test-pass';
  state.role = 'admin';
});

test('roleOf: admin только при явном role: admin', () => {
  assert.equal(roleOf({ role: 'admin' }), 'admin');
  assert.equal(roleOf({ role: 'client' }), 'client');
  assert.equal(roleOf({ role: 'ADMIN' }), 'client');
  assert.equal(roleOf({}), 'client');
  assert.equal(roleOf(null), 'client');
  assert.equal(roleOf(undefined), 'client');
});

test('isAdmin читает state.role; forgetPassword сбрасывает роль', () => {
  state.role = 'admin';
  assert.equal(isAdmin(), true);
  state.ordersAlert = 'x';
  forgetPassword();
  assert.equal(state.role, 'client');
  assert.equal(state.ordersAlert, '');
  assert.equal(isAdmin(), false);
});

test('problemsText: первые пять и «и ещё N», мусор отбрасывается', () => {
  assert.equal(problemsText([]), '');
  assert.equal(problemsText(undefined), '');
  assert.equal(problemsText(['ГФ 10003', ' ', null, 'ГФ 10350 — несколько файлов']), 'ГФ 10003, ГФ 10350 — несколько файлов');
  const seven = Array.from({ length: 7 }, (_, i) => `ГФ ${10001 + i}`);
  assert.equal(problemsText(seven), 'ГФ 10001, ГФ 10002, ГФ 10003, ГФ 10004, ГФ 10005 и ещё 2');
  assert.equal(problemsText(seven, 2), 'ГФ 10001, ГФ 10002 и ещё 5');
});

test('layoutsView: каждая строка таблицы статусов', () => {
  const url = 'https://disk.yandex.ru/d/X';
  const view = (status, extra = {}) => layoutsView({ status, url, problems: ['ГФ 10003'], ...extra });
  assert.deepEqual(view('queued'), { tone: 'pending', text: 'Макеты в очереди', url, note: '', canRebuild: false });
  assert.deepEqual(view('building'), { tone: 'pending', text: 'Собираем макеты…', url: '', note: '', canRebuild: false });
  assert.deepEqual(view('done'), { tone: 'good', text: 'Папка макетов', url, note: '', canRebuild: true });
  assert.deepEqual(view('partial'), { tone: 'warn', text: 'Папка макетов', url, note: 'Проблемы: ГФ 10003', canRebuild: true });
  assert.deepEqual(view('partial', { problems: [] }).note, '');
  assert.deepEqual(view('empty'), { tone: 'warn', text: 'Макеты не найдены', url: '', note: 'ГФ 10003', canRebuild: true });
  assert.deepEqual(view('failed'), { tone: 'bad', text: 'Макеты не собраны', url: '', note: '', canRebuild: true });
  assert.equal(view(''), null);
  assert.equal(view('unknown'), null);
  assert.equal(layoutsView(undefined), null);
  assert.equal(layoutsView('done'), null);
  assert.equal(layoutsView({ status: 'done', url: 42 }).url, '');
});

test('hasPendingLayouts и needsLayoutsRefresh', () => {
  const pending = [{ layouts: { status: 'done' } }, { layouts: { status: 'building' } }];
  const idle = [{ layouts: { status: 'done' } }, {}, null];
  assert.equal(hasPendingLayouts(pending), true);
  assert.equal(hasPendingLayouts([{ layouts: { status: 'queued' } }]), true);
  assert.equal(hasPendingLayouts(idle), false);
  assert.equal(hasPendingLayouts(undefined), false);
  assert.equal(needsLayoutsRefresh('admin', pending, '#orders'), true);
  assert.equal(needsLayoutsRefresh('client', pending, '#orders'), false);
  assert.equal(needsLayoutsRefresh('admin', pending, ''), false);
  assert.equal(needsLayoutsRefresh('admin', idle, '#orders'), false);
  assert.equal(LAYOUTS_REFRESH_MS, 20000);
});

test('deleteOutcome и adminErrorText', () => {
  assert.equal(deleteOutcome(''), 'removed');
  assert.equal(deleteOutcome(undefined), 'removed');
  assert.equal(deleteOutcome('ORDER_NOT_FOUND'), 'removed');
  assert.equal(deleteOutcome('ADMIN_REQUIRED'), 'role');
  assert.equal(deleteOutcome('ORDER_DELETE_FAILED'), 'failed');
  assert.equal(deleteOutcome('NO_ANSWER'), 'failed');
  assert.equal(adminErrorText({ code: 'ADMIN_REQUIRED', reason: 'Только администратору' }, 'Заявка не удалена'), 'Только администратору');
  assert.equal(adminErrorText({ code: 'ORDER_DELETE_FAILED', reason: 'Не удалось удалить заявку: занято' }, 'Заявка не удалена'), 'Не удалось удалить заявку: занято');
  assert.equal(adminErrorText({ code: 'INVALID_ORDER_NUMBER', reason: 'Неверный номер заявки' }, 'Заявка не удалена'), 'Заявка не удалена: Неверный номер заявки');
  assert.equal(adminErrorText({ name: 'AbortError' }, 'Сборка не запущена'), 'Сборка не запущена: Сервер не ответил вовремя');
  assert.equal(adminErrorText(undefined, 'X'), 'X: Сервер ответил с ошибкой');
});

test('postAction: тело с action, паролем и полями; ответ ok возвращается', async () => {
  stubFetch({ ok: true, number: 'FB-0001 от 01.01.2026', deletedLines: 3 });
  const reply = await deleteOrderRequest('FB-0001 от 01.01.2026');
  assert.equal(reply.deletedLines, 3);
  assert.equal(requests[0].url, API);
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(requests[0].body, { action: 'deleteOrder', password: 'admin-test-pass', number: 'FB-0001 от 01.01.2026' });

  stubFetch({ ok: true, number: 'FB-0002', layouts: { status: 'queued', url: '', problems: [] } });
  const rebuilt = await rebuildLayoutsRequest('FB-0002');
  assert.equal(rebuilt.layouts.status, 'queued');
  assert.deepEqual(requests[0].body, { action: 'rebuildLayouts', password: 'admin-test-pass', number: 'FB-0002' });
});

test('postAction: ADMIN_REQUIRED делает роль клиентской и бросает ошибку с code и reason', async () => {
  stubFetch({ error: { code: 'ADMIN_REQUIRED', message: 'Это действие доступно только администратору' } });
  await assert.rejects(postAction('deleteOrder', { number: 'FB-0001' }), error => {
    assert.equal(error.code, 'ADMIN_REQUIRED');
    assert.equal(error.reason, 'Это действие доступно только администратору');
    return true;
  });
  assert.equal(state.role, 'client');
});

test('postAction: другая ошибка роль не меняет; ответ без ok — NO_ANSWER', async () => {
  stubFetch({ error: { code: 'ORDER_NOT_FOUND', message: 'нет' } });
  await assert.rejects(postAction('deleteOrder', { number: 'FB-1' }), { code: 'ORDER_NOT_FOUND' });
  assert.equal(state.role, 'admin');
  stubFetch({});
  await assert.rejects(postAction('deleteOrder', { number: 'FB-1' }), error => error.message === 'NO_ANSWER' && error.code === '');
});

// ───── adminBar ─────

const entry = (layouts, number = 'FB-0042 от 09.11.2026') => ({ number, layouts });
const buttons = bar => bar.byTag('button');
const links = bar => bar.byTag('a');

test('adminBar: готово — ссылка в новой вкладке с noopener и «Пересобрать папку», удаления нет', () => {
  const bar = adminBar(entry({ status: 'done', url: 'https://disk.yandex.ru/d/X', problems: [] }));
  assert.equal(bar.dataset.tone, 'good');
  const [link] = links(bar);
  assert.equal(link.getAttribute('href'), 'https://disk.yandex.ru/d/X');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /noopener/);
  assert.deepEqual(buttons(bar).map(b => b.textContent), ['Пересобрать папку']);
  assert.ok(buttons(bar).every(b => b.type === 'button' && !b.disabled));
  assert.match(buttons(bar)[0].getAttribute('aria-label'), /FB-0042 от 09\.11\.2026/);
});

test('adminBar: не все макеты — ссылка и проблемы', () => {
  const bar = adminBar(entry({ status: 'partial', url: 'https://disk.yandex.ru/d/X', problems: ['ГФ 10003', 'ГФ 10350 — несколько файлов'] }));
  assert.equal(bar.dataset.tone, 'warn');
  assert.equal(links(bar).length, 1);
  assert.match(bar.textContent, /Проблемы: ГФ 10003, ГФ 10350 — несколько файлов/);
});

test('adminBar: собирается и ошибка — без ссылки на папку; в очереди после пересборки — старая папка открыта', () => {
  const building = adminBar(entry({ status: 'building', url: 'https://disk.yandex.ru/d/X', problems: [] }));
  assert.equal(links(building).length, 0);
  assert.deepEqual(buttons(building), []);
  assert.match(building.textContent, /Собираем макеты/);

  const failed = adminBar(entry({ status: 'failed', url: '', problems: [] }));
  assert.equal(links(failed).length, 0);
  assert.equal(failed.dataset.tone, 'bad');
  assert.deepEqual(buttons(failed).map(b => b.textContent), ['Собрать папку']);

  const empty = adminBar(entry({ status: 'empty', url: '', problems: ['ГФ 10003'] }));
  assert.deepEqual(buttons(empty).map(b => b.textContent), ['Собрать папку']);

  const queued = adminBar(entry({ status: 'queued', url: 'https://disk.yandex.ru/d/OLD', problems: [] }));
  assert.deepEqual(links(queued).map(a => a.getAttribute('href')), ['https://disk.yandex.ru/d/OLD']);
  assert.deepEqual(buttons(queued), []);
});

test('adminBar: старая заявка без layouts — полосы нет', () => {
  assert.equal(adminBar(entry(undefined)), null);
  assert.equal(adminBar(entry({ status: '', url: '', problems: [] })), null);
});

test('adminBar и deleteOrderButton: клики вызывают onRebuild и onDelete с заявкой; busy выключает кнопки', () => {
  const calls = [];
  const item = entry({ status: 'done', url: 'https://disk.yandex.ru/d/X', problems: [] });
  const bar = adminBar(item, { onRebuild: (e, button) => calls.push(['rebuild', e.number, button.textContent]) });
  const remove = deleteOrderButton(item, { onDelete: (e, button) => calls.push(['delete', e.number, button.title]) });
  assert.equal(remove.className, 'sent-order-delete');
  assert.equal(remove.type, 'button');
  assert.equal(remove.title, 'Удалить заявку');
  assert.equal(remove.getAttribute('aria-label'), `Удалить заявку ${item.number}`);
  assert.equal(remove.dataset.focusKey, 'delete');
  remove.click();
  buttons(bar)[0].click();
  assert.deepEqual(calls, [['delete', item.number, 'Удалить заявку'], ['rebuild', item.number, 'Пересобрать папку']]);

  const busyBar = adminBar(item, { busy: 'delete' });
  const busyRemove = deleteOrderButton(item, { busy: 'delete', onDelete: () => calls.push('again') });
  assert.deepEqual(buttons(busyBar).map(b => [b.textContent, b.disabled]), [['Пересобрать папку', true]]);
  assert.equal(busyRemove.disabled, true);
  assert.equal(busyRemove.title, 'Удаляем…');
  assert.equal(busyRemove.getAttribute('aria-label'), `Удаляем заявку ${item.number}`);
  busyRemove.click();
  assert.equal(calls.length, 2);
  assert.equal(buttons(adminBar(item, { busy: 'rebuild' }))[0].textContent, 'Запускаем…');
  assert.equal(deleteOrderButton(item, { busy: 'rebuild' }).disabled, true);
});

test('deleteOrderButton есть и у старой заявки без папки', () => {
  const old = entry(undefined);
  assert.equal(adminBar(old), null);
  assert.equal(deleteOrderButton(old).getAttribute('aria-label'), `Удалить заявку ${old.number}`);
});

test('rebuildLabel: есть папка — «Пересобрать папку», нет — «Собрать папку»', () => {
  assert.equal(rebuildLabel({ status: 'done', url: 'https://disk.yandex.ru/d/X' }), 'Пересобрать папку');
  assert.equal(rebuildLabel({ status: 'partial', url: 'https://disk.yandex.ru/d/X' }), 'Пересобрать папку');
  assert.equal(rebuildLabel({ status: 'failed', url: '' }), 'Собрать папку');
  assert.equal(rebuildLabel({ status: 'empty', url: '' }), 'Собрать папку');
});

test('adminBar: пробелы вокруг ссылки обрезаются', () => {
  const bar = adminBar(entry({ status: 'done', url: '  https://disk.yandex.ru/d/X  ', problems: [] }));
  assert.equal(links(bar)[0].getAttribute('href'), 'https://disk.yandex.ru/d/X');
});
