// Загрузка каталога из Apps Script и статус данных в шапке.
import { state } from './state.js';
import { $ } from './format.js';
import { demoCatalog, emptyCatalog, normalizeCatalog } from './catalog.js';
import { accessErrors, accessPassword, askPassword, closeLogin, forgetPassword, showPageLoader } from './auth.js';
import { renderCompanies, renderSearch, renderSelected } from './calculator.js';
import { renderOrder, repriceOrder } from './order.js';
import { loadOrders } from './orders.js';

export function apiUrl() {
  return String(window.FBPRINT_CONFIG?.apiUrl ?? '').trim();
}

export function setDataStatus(state, message) {
  const meta = $('.header-meta');
  meta.dataset.state = state;
  meta.ariaBusy = String(state === 'loading');
  $('#data-status').textContent = message;
  $('#refresh-data').disabled = state === 'loading';
}

export function applyCatalog(nextData) {
  const selectedKey = state.article ? `${state.article.companyId}/${state.article.sku}` : null;
  state.data = nextData;

  if (!state.data.companies.some(company => company.id === state.companyId)) {
    state.companyId = state.data.companies[0]?.id ?? '';
  }
  state.article = selectedKey
    ? state.data.articles.find(item => `${item.companyId}/${item.sku}` === selectedKey) ?? null
    : null;

  $('#article-search').disabled = !state.data.companies.length;
  renderCompanies();
  renderSelected({ resetQuantity: false });
  renderSearch($('#article-search').value);
  repriceOrder();
  renderOrder();
}

export function showCatalogError(title, message) {
  $('#catalog-alert-title').textContent = title;
  $('#catalog-alert-message').textContent = message;
  $('#catalog-alert').hidden = !title;
}

// Ошибка с полем reason уже понятна клиенту (например, ошибка в таблице каталога).
export function failureReason(error) {
  if (error.reason) return error.reason;
  if (error.name === 'AbortError') return 'Сервер не ответил вовремя';
  if (error.name === 'TypeError') return 'Нет связи с сервером';
  return 'Сервер ответил с ошибкой';
}

export async function loadData() {
  const url = apiUrl();
  if (!url) {
    showPageLoader(false);
    applyCatalog(normalizeCatalog(demoCatalog));
    setDataStatus('demo', 'Демо-режим');
    loadOrders();
    return;
  }

  const password = accessPassword();
  if (!password) {
    askPassword();
    return;
  }
  // Окно входа открыто — значит, пароль ввели вручную и загрузка крутится на кнопке.
  const typedPassword = $('#login-dialog').open;
  showPageLoader(!typedPassword);

  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  const timeoutMs = Number(window.FBPRINT_CONFIG?.requestTimeoutMs) || 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  setDataStatus('loading', 'Обновляем данные…');

  try {
    // Пароль — в теле POST, а не в ссылке: так он не попадает в историю и журналы.
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action: 'catalog', password }),
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`API ответил с кодом ${response.status}`);

    const payload = await response.json();
    if (accessErrors.includes(payload?.error?.code)) {
      forgetPassword();
      applyCatalog(emptyCatalog);
      askPassword(payload.error.code === 'ACCESS_DENIED' && !typedPassword
        ? 'Сохранённый пароль больше не подходит — введите новый.'
        : payload.error.message);
      return;
    }

    closeLogin();
    let catalog;
    try {
      catalog = normalizeCatalog(payload);
    } catch (error) {
      // Ошибку в таблице исправляет менеджер: место ошибки названо словами листа.
      error.reason = `В таблице каталога ошибка (${error.message}). Сообщите об этом менеджеру FB Print`;
      throw error;
    }
    applyCatalog(catalog);
    state.loadedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    setDataStatus('live', `Обновлено в ${state.loadedAt}`);
    showCatalogError('');
    loadOrders();
  } catch (error) {
    // Запрос отменён более новым нажатием «Обновить» — ошибки нет.
    if (controller !== state.loadController) return;
    // Пароль принят (или не проверен из-за сети) — ошибку каталога показываем на странице, а не в окне входа.
    closeLogin();
    console.warn('Каталог не загружен:', error);
    const reason = failureReason(error);
    const advice = error.reason ? '' : ' Нажмите «Обновить» через минуту. Если не поможет, напишите менеджеру FB Print.';
    if (state.loadedAt) {
      setDataStatus('error', `Не обновлено · данные от ${state.loadedAt}`);
      showCatalogError('Каталог не обновился', `${reason}. Расчёт идёт по данным, загруженным в ${state.loadedAt}.${advice}`);
    } else {
      applyCatalog(emptyCatalog);
      setDataStatus('error', 'Каталог недоступен');
      showCatalogError('Каталог не загрузился', `${reason}. Без каталога расчёт недоступен.${advice}`);
    }
  } finally {
    clearTimeout(timeout);
    // Запрос, отменённый более новым, экран не трогает — его уберёт новый запрос.
    if (controller === state.loadController) showPageLoader(false);
  }
}
