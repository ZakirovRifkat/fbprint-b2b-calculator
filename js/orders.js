// Вкладка «Заявки»: список из таблицы, статусы, переключение вкладок.
import { state } from './state.js';
import { $, cell, integer, money } from './format.js';
import { accessErrors, accessPassword } from './auth.js';
import { apiUrl, loadData } from './load.js';
import { renderDock } from './order.js';
import { toast } from './toast.js';
import { confirmAction } from './confirm.js';
import { forgetArticles, loadArticles } from './articles.js';
import { LAYOUTS_REFRESH_MS, adminBar, adminErrorText, deleteOrderButton, deleteOrderRequest, setOrderStatusRequest, statusSelect, deleteOutcome, isAdmin, needsLayoutsRefresh, rebuildLayoutsRequest, roleOf } from './admin.js';

// Вкладка «Заявки»: все заявки с листа «Заявки» в таблице, новые сверху.
// Пароль один на всех, поэтому список общий для всех клиентов.
// Позиции заявки загружаются, когда её раскрывают (лист «Позиции заявок»).
export const statusLabels = { work: 'В работе', shipped: 'Отгружено' };
export const dateTime = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// «Отгружено» ставит администратор на сайте или менеджер в таблице (лист «Заявки», колонка E); всё остальное — «В работе».
export function orderStatus(entry) {
  return entry.status === 'shipped' ? 'shipped' : 'work';
}

export function renderOrders(list = state.ordersList) {
  const root = $('#sent-orders-list');
  const admin = isAdmin();
  // У администратора список перерисовывается сам, пока собираются папки.
  // Фокус возвращаем на ту же кнопку той же заявки, чтобы он не улетал в начало страницы.
  const focused = root.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.dataset.focusKey ?? '';
  const focusNumber = focused?.closest('li')?.dataset.number ?? '';
  root.innerHTML = '';
  renderAdminChrome();
  const counts = { all: list.length, work: 0, shipped: 0 };
  list.forEach(entry => { counts[orderStatus(entry)] += 1; });
  Object.entries(counts).forEach(([filter, count]) => { $(`#filter-${filter}`).textContent = count; });
  document.querySelectorAll('#orders-toolbar .orders-filter button').forEach(button => {
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
      // У администратора статус — выпадающий список рядом с заголовком, метка в заголовке не нужна.
      ...(admin ? [] : [cell('em', statusLabels[orderStatus(entry)], orderStatus(entry))]),
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
    if (admin) {
      // Корзина — в строке заголовка, рядом с суммой: удаляется заявка целиком, раскрывать её не нужно.
      // Отдельной кнопкой рядом: внутри кнопки заголовка другую кнопку разместить нельзя.
      const top = document.createElement('div');
      top.className = 'sent-order-top';
      const busy = busyOrders.get(entry.number) ?? '';
      top.append(head, statusSelect(entry, { onChange: changeStatus, busy }), deleteOrderButton(entry, { onDelete: deleteOrderWithConfirm, busy }));
      item.append(top);
    } else {
      item.append(head);
    }
    // Полоса администратора — отдельно от кнопки заголовка: в кнопке не может быть ссылок и кнопок.
    if (admin) {
      item.dataset.number = entry.number;
      head.dataset.focusKey = 'head';
      const bar = adminBar(entry, { onRebuild: rebuildLayouts, busy: busyOrders.get(entry.number) ?? '' });
      if (bar) item.append(bar);
    }
    item.append(details);
    root.append(item);
  });
  if (focusKey && focusNumber) {
    const item = [...root.children].find(child => child.dataset.number === focusNumber);
    // Выключенная кнопка («Удаляем…») фокус не принимает — тогда он на заголовке заявки.
    (item?.querySelector(`[data-focus-key="${focusKey}"]:not(:disabled)`) ?? item?.querySelector('.sent-order-head'))?.focus({ preventScroll: true });
  }
  $('#orders-empty').hidden = !state.ordersLoaded || list.length > 0;
  $('#orders-toolbar').hidden = false;
  $('#orders-toolbar .orders-filter').hidden = !list.length;
  root.hidden = !shown.length;
  $('#orders-none').hidden = !list.length || shown.length > 0;
  $('#orders-none').textContent = state.ordersFilter === 'shipped' ? 'Отгруженных заявок пока нет.' : 'Все заявки отгружены.';
  $('#orders-count').textContent = list.length;
  $('#orders-count').hidden = !list.length;
}

// Метка в шапке и предупреждение о Диске видны только администратору.
function renderAdminChrome() {
  const admin = isAdmin();
  $('#admin-badge').hidden = !admin;
  // Вкладка «Артикулы» — только у администратора. Открыта, а роль клиентская — показываем расчёт.
  $('#articles-tab').hidden = !admin;
  if (!admin) forgetArticles();
  if (location.hash === '#articles') {
    showView();
    loadArticles();
  }
  $('#orders-admin-alert').textContent = admin ? state.ordersAlert : '';
  $('#orders-admin-alert').hidden = !admin || !state.ordersAlert;
}

// Заявки, которые сейчас удаляются или пересобираются: их кнопки остаются выключенными,
// даже если список успеет перерисоваться.
const busyOrders = new Map();

function forgetOrder(number) {
  state.ordersList = state.ordersList.filter(entry => entry.number !== number);
  openOrders.delete(number);
  linesCache.delete(number);
  companyTab.delete(number);
}

// Фокус — на кнопку заявки после перерисовки; кнопки нет (роль сменилась) — на заголовок заявки или списка.
function focusOrderControl(number, key) {
  const item = [...$('#sent-orders-list').children].find(child => child.dataset.number === number);
  (item?.querySelector(`[data-focus-key="${key}"]`) ?? item?.querySelector('.sent-order-head') ?? $('#orders-title')).focus();
}

function adminActionFailed(error, prefix) {
  // Пароль сменили, пока страница была открыта: загрузка каталога заново покажет окно входа.
  if (accessErrors.includes(error.code)) {
    loadData();
    return;
  }
  toast(adminErrorText(error, prefix), { persist: true });
}

// Удаление: заявка и её позиции исчезают с обоих листов таблицы. Папка на Яндекс Диске остаётся.
// Смена статуса в списке: пишет «Отгружено» в колонку E «Заявок» или очищает её. Подтверждения нет — статус легко вернуть.
async function changeStatus(entry, shipped) {
  busyOrders.set(entry.number, 'status');
  renderOrders();
  try {
    const reply = await setOrderStatusRequest(entry.number, shipped);
    const current = state.ordersList.find(item => item.number === entry.number);
    if (current) current.status = reply.status;
    toast(shipped ? `Заявка ${entry.number} отгружена.` : `Заявка ${entry.number} снова в работе.`);
  } catch (error) {
    busyOrders.delete(entry.number);
    renderOrders();
    focusOrderControl(entry.number, 'status');
    adminActionFailed(error, 'Статус не изменён');
    return;
  }
  busyOrders.delete(entry.number);
  renderOrders();
  focusOrderControl(entry.number, 'status');
}

async function deleteOrderWithConfirm(entry) {
  const confirmed = await confirmAction({
    title: `Удалить заявку ${entry.number}?`,
    message: 'Заявка и её позиции исчезнут из таблицы. Папка макетов на Яндекс Диске останется. Удаление не отменить.',
    confirmLabel: 'Удалить'
  });
  if (!confirmed) return;
  busyOrders.set(entry.number, 'delete');
  renderOrders();
  let failure = null;
  try {
    await deleteOrderRequest(entry.number);
  } catch (error) {
    failure = error;
  } finally {
    busyOrders.delete(entry.number);
  }
  if (deleteOutcome(failure?.code) !== 'removed') {
    renderOrders();
    focusOrderControl(entry.number, 'delete');
    adminActionFailed(failure, 'Заявка не удалена');
    return;
  }
  // Фокус — на следующую заявку списка (или предыдущую, если удалили последнюю).
  const items = [...$('#sent-orders-list').children];
  const index = items.findIndex(child => child.dataset.number === entry.number);
  forgetOrder(entry.number);
  renderOrders();
  toast(`Заявка ${entry.number} удалена.`);
  const heads = $('#sent-orders-list').querySelectorAll('.sent-order-head');
  const next = heads[Math.min(Math.max(index, 0), heads.length - 1)];
  (next ?? $('#orders-title')).focus();
}

// «Пересобрать папку»: заявка снова встаёт в очередь, файлы копируются в ту же папку.
async function rebuildLayouts(entry) {
  busyOrders.set(entry.number, 'rebuild');
  renderOrders();
  try {
    const payload = await rebuildLayoutsRequest(entry.number);
    busyOrders.delete(entry.number);
    const current = state.ordersList.find(item => item.number === entry.number);
    if (current && payload.layouts) current.layouts = payload.layouts;
    renderOrders();
    toast(`Макеты заявки ${entry.number} собираются заново.`);
    scheduleLayoutsRefresh();
  } catch (error) {
    busyOrders.delete(entry.number);
    renderOrders();
    focusOrderControl(entry.number, 'rebuild');
    adminActionFailed(error, 'Сборка не запущена');
    if (error.code === 'ORDER_NOT_FOUND') loadOrders();
  }
}

// Пока папки собираются, администратор видит новое состояние без перезагрузки страницы.
function scheduleLayoutsRefresh() {
  clearTimeout(state.layoutsTimer);
  state.layoutsTimer = null;
  if (!needsLayoutsRefresh(state.role, state.ordersList, location.hash)) return;
  state.layoutsTimer = setTimeout(() => {
    state.layoutsTimer = null;
    if (location.hash === '#orders') loadOrders({ quiet: true });
  }, LAYOUTS_REFRESH_MS);
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
// quiet — фоновое обновление у администратора: без «Обновляем заявки…» в строке состояния.
export async function loadOrders({ quiet = false } = {}) {
  if (!apiUrl()) {
    state.role = 'client';
    state.ordersAlert = '';
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
  if (!quiet) $('#orders-sync').textContent = 'Обновляем заявки…';
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
    state.role = roleOf(payload);
    state.ordersAlert = state.role === 'admin' ? String(payload.layoutsAlert ?? '') : '';
    state.ordersList = payload.orders;
    state.ordersLoaded = true;
    renderOrders();
    $('#orders-sync').textContent = `Обновлено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    scheduleLayoutsRefresh();
  } catch (error) {
    if (controller !== state.ordersController) return;
    state.ordersLoaded = true;
    renderOrders();
    $('#orders-sync').textContent = state.ordersList.length
      ? 'Не удалось обновить заявки — показан последний загруженный список.'
      : 'Не удалось загрузить заявки. Обновите страницу.';
    console.warn('Заявки не загружены:', error);
    // Связь пропала во время сборки — пробуем снова через 20 секунд.
    scheduleLayoutsRefresh();
  } finally {
    clearTimeout(timeout);
  }
}

// Вкладки в шапке. Раздел задаёт адрес: #orders — заявки, #articles — артикулы (только администратору),
// всё остальное — расчёт. Так работают кнопка «Назад» и ссылка на раздел.
export function currentView() {
  if (location.hash === '#orders') return 'orders';
  if (location.hash === '#articles' && isAdmin()) return 'articles';
  return 'calc';
}

const VIEW_TITLES = { calc: 'FB-print — Расчёт стоимости', orders: 'FB-print — Заявки', articles: 'FB-print — Артикулы' };

export function showView() {
  const view = currentView();
  $('#top').hidden = view !== 'calc';
  $('#orders-view').hidden = view !== 'orders';
  $('#articles-view').hidden = view !== 'articles';
  document.querySelectorAll('.view-tabs a').forEach(tab => {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  document.title = VIEW_TITLES[view];
  renderDock();
}
