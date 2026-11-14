// Вкладка «Заявки»: список из таблицы, статусы, переключение вкладок.
import { state } from './state.js';
import { $, cell, integer, money } from './format.js';
import { accessPassword } from './auth.js';
import { apiUrl } from './load.js';
import { renderDock } from './order.js';

// Вкладка «Заявки»: все заявки с листа «Заявки» в таблице, новые сверху.
// Пароль один на всех, поэтому список общий для всех клиентов.
// Позиции заявки загружаются, когда её раскрывают (лист «Позиции заявок»).
export const statusLabels = { work: 'В работе', shipped: 'Отгружено' };
export const dateTime = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// «Отгружено» ставит менеджер в таблице (лист «Заявки», колонка E); всё остальное — «В работе».
export function orderStatus(entry) {
  return entry.status === 'shipped' ? 'shipped' : 'work';
}

export function renderOrders(list = state.ordersList) {
  const root = $('#sent-orders-list');
  root.innerHTML = '';
  const counts = { all: list.length, work: 0, shipped: 0 };
  list.forEach(entry => { counts[orderStatus(entry)] += 1; });
  Object.entries(counts).forEach(([filter, count]) => { $(`#filter-${filter}`).textContent = count; });
  document.querySelectorAll('.orders-filter button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.filter === state.ordersFilter));
  });
  const shown = list.filter(entry => state.ordersFilter === 'all' || orderStatus(entry) === state.ordersFilter);
  shown.forEach((entry, index) => {
    const item = document.createElement('li');
    const sentAt = new Date(entry.sentAt);
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'sent-order-head';
    head.setAttribute('aria-expanded', String(openOrders.has(entry.number)));
    head.setAttribute('aria-controls', `sent-order-lines-${index}`);
    head.append(
      cell('strong', entry.number),
      cell('span', [Number.isNaN(sentAt.getTime()) ? '' : dateTime.format(sentAt), entry.company].filter(Boolean).join(' · ')),
      cell('em', statusLabels[orderStatus(entry)], orderStatus(entry)),
      cell('b', money.format(entry.total))
    );
    head.insertAdjacentHTML('beforeend', '<svg class="sent-order-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>');
    const details = document.createElement('div');
    details.className = 'sent-order-lines';
    details.id = `sent-order-lines-${index}`;
    details.hidden = !openOrders.has(entry.number);
    head.addEventListener('click', () => {
      const open = !openOrders.has(entry.number);
      if (open) openOrders.add(entry.number);
      else openOrders.delete(entry.number);
      head.setAttribute('aria-expanded', String(open));
      details.hidden = !open;
      if (open) showOrderLines(entry, details);
    });
    if (!details.hidden) showOrderLines(entry, details);
    item.append(head, details);
    root.append(item);
  });
  $('#orders-empty').hidden = !state.ordersLoaded || list.length > 0;
  $('#orders-toolbar').hidden = false;
  $('.orders-filter').hidden = !list.length;
  root.hidden = !shown.length;
  $('#orders-none').hidden = !list.length || shown.length > 0;
  $('#orders-none').textContent = state.ordersFilter === 'shipped' ? 'Отгруженных заявок пока нет.' : 'Все заявки отгружены.';
  $('#orders-count').textContent = list.length;
  $('#orders-count').hidden = !list.length;
}

// Раскрытые заявки и загруженные позиции переживают обновление списка.
// Позиции отправленной заявки не меняются, поэтому загружаются один раз.
const openOrders = new Set();
const linesCache = new Map();

async function fetchOrderLines(number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(window.FBPRINT_CONFIG?.requestTimeoutMs) || 10000);
  try {
    const response = await fetch(apiUrl(), {
      method: 'POST',
      body: JSON.stringify({ action: 'orderLines', password: accessPassword(), number }),
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });
    const payload = await response.json();
    if (!Array.isArray(payload?.lines)) throw new Error(payload?.error?.message ?? 'нет ответа');
    return payload.lines;
  } finally {
    clearTimeout(timeout);
  }
}

async function showOrderLines(entry, root) {
  if (linesCache.has(entry.number)) {
    renderOrderLines(linesCache.get(entry.number), root, entry.number);
    return;
  }
  const loading = document.createElement('div');
  loading.className = 'order-lines-loading';
  loading.setAttribute('role', 'status');
  loading.innerHTML = '<span class="lines-spinner" aria-hidden="true"></span><span class="visually-hidden">Загружаем позиции</span>';
  root.replaceChildren(loading);
  try {
    const lines = await fetchOrderLines(entry.number);
    linesCache.set(entry.number, lines);
    renderOrderLines(lines, root, entry.number);
  } catch (error) {
    console.warn(`Позиции заявки ${entry.number} не загружены:`, error);
    const retry = cell('button', 'Повторить');
    retry.type = 'button';
    retry.className = 'text-button';
    retry.addEventListener('click', () => showOrderLines(entry, root));
    const message = cell('p', 'Не удалось загрузить позиции. ', 'note');
    message.append(retry);
    root.replaceChildren(message);
  }
}

// Позиции в том порядке, в каком их отправили. В заявке на несколько компаний — вкладка на каждую,
// чтобы длинная заявка не превращалась в одну бесконечную таблицу.
const companyTab = new Map();

function renderOrderLines(lines, root, number) {
  if (!lines.length) {
    root.replaceChildren(cell('p', 'Позиций нет: заявку отправили до того, как сайт начал их сохранять. Состав заявки есть у менеджера в Excel.', 'note'));
    return;
  }
  const companies = [...new Set(lines.map(line => line.company))];
  if (companies.length < 2) {
    root.replaceChildren(linesTable(lines));
    return;
  }
  if (!companies.includes(companyTab.get(number))) companyTab.set(number, companies[0]);
  const tabs = document.createElement('div');
  tabs.className = 'order-lines-tabs';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Компания');
  companies.forEach(company => {
    const own = lines.filter(line => line.company === company);
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.setAttribute('aria-pressed', String(company === companyTab.get(number)));
    tab.append(company, cell('span', own.length));
    tab.addEventListener('click', () => {
      companyTab.set(number, company);
      renderOrderLines(lines, root, number);
      root.querySelector('.order-lines-tabs [aria-pressed=true]')?.focus();
    });
    tabs.append(tab);
  });
  root.replaceChildren(tabs, linesTable(lines.filter(line => line.company === companyTab.get(number))));
}

function linesTable(lines) {
  const table = document.createElement('table');
  table.className = 'order-table order-lines-table';
  table.innerHTML = '<thead><tr><th>Артикул</th><th>Название</th><th class="num">Тираж</th><th>Срок</th><th class="num">Цена за шт.</th><th class="num">Сумма</th></tr></thead>';
  const body = document.createElement('tbody');
  lines.forEach(line => {
    const row = document.createElement('tr');
    const name = cell('td', line.name, 'name');
    if (line.condition) name.append(cell('small', line.condition));
    const quantity = cell('td', `${integer.format(line.quantity)} шт.`, 'quantity');
    const price = cell('td', money.format(line.unitPrice), 'price');
    const total = cell('td', money.format(line.total), 'total');
    [quantity, price, total].forEach(node => { node.className = 'num'; });
    row.append(cell('td', line.sku, 'code'), name, quantity, cell('td', line.urgency, 'urgency'), price, total);
    body.append(row);
  });
  table.append(body);
  const wrap = document.createElement('div');
  wrap.className = 'order-table-wrap';
  wrap.append(table);
  return wrap;
}

// Список и статусы загружаются при входе, при открытии вкладки и после отправки заявки.
// Если таблица не ответила, остаётся последний загруженный список с пометкой.
export async function loadOrders() {
  if (!apiUrl()) {
    state.ordersLoaded = true;
    renderOrders();
    $('#orders-sync').textContent = 'Демо-режим: заявки появятся после подключения таблицы.';
    return;
  }
  const password = accessPassword();
  if (!password) return;
  state.ordersController?.abort();
  const controller = new AbortController();
  state.ordersController = controller;
  const timeout = setTimeout(() => controller.abort(), Number(window.FBPRINT_CONFIG?.requestTimeoutMs) || 10000);
  $('#orders-sync').textContent = 'Обновляем заявки…';
  try {
    const response = await fetch(apiUrl(), {
      method: 'POST',
      body: JSON.stringify({ action: 'orders', password }),
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });
    const payload = await response.json();
    if (!Array.isArray(payload?.orders)) throw new Error(payload?.error?.message ?? 'нет ответа');
    state.ordersList = payload.orders;
    state.ordersLoaded = true;
    renderOrders();
    $('#orders-sync').textContent = `Обновлено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    if (controller !== state.ordersController) return;
    state.ordersLoaded = true;
    renderOrders();
    $('#orders-sync').textContent = state.ordersList.length
      ? 'Не удалось обновить заявки — показан последний загруженный список.'
      : 'Не удалось загрузить заявки. Нажмите «Обновить».';
    console.warn('Заявки не загружены:', error);
  } finally {
    clearTimeout(timeout);
  }
}

// Вкладки в шапке. Раздел задаёт адрес: #orders — заявки, всё остальное — расчёт.
// Так работают кнопка «Назад» и ссылка на раздел.
export function showView() {
  const view = location.hash === '#orders' ? 'orders' : 'calc';
  $('#top').hidden = view !== 'calc';
  $('#orders-view').hidden = view !== 'orders';
  document.querySelectorAll('.view-tabs a').forEach(tab => {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  document.title = view === 'orders' ? 'FB-print — Заявки' : 'FB-print — Расчёт стоимости';
  renderDock();
}
