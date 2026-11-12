// Вкладка «Заявки»: список из таблицы, статусы, переключение вкладок.
import { state } from './state.js';
import { $, cell, money } from './format.js';
import { accessPassword } from './auth.js';
import { apiUrl } from './load.js';
import { renderDock } from './order.js';

// Вкладка «Заявки»: все заявки с листа «Заявки» в таблице, новые сверху.
// Пароль один на всех, поэтому список общий для всех клиентов. Позиции заявки — в Telegram и Excel.
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
  shown.forEach(entry => {
    const item = document.createElement('li');
    const sentAt = new Date(entry.sentAt);
    item.append(
      cell('strong', entry.number),
      cell('span', [Number.isNaN(sentAt.getTime()) ? '' : dateTime.format(sentAt), entry.company].filter(Boolean).join(' · ')),
      cell('em', statusLabels[orderStatus(entry)], orderStatus(entry)),
      cell('b', money.format(entry.total))
    );
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
  document.title = view === 'orders' ? 'FB Print — Заявки' : 'FB Print — Расчёт стоимости';
  renderDock();
}
