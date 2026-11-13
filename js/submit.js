// Отправка заявки менеджеру через Apps Script.
import { state } from './state.js';
import { $, money, plural } from './format.js';
import { conditionLabels, urgencyLabels } from './pricing.js';
import { accessPassword } from './auth.js';
import { apiUrl, failureReason } from './load.js';
import { orderHasProblems, orderTotal, resetOrderFilters } from './order.js';
import { loadOrders } from './orders.js';
import { orderFileBase64 } from './excel.js';
import { toast } from './toast.js';

// Пока заявка уходит, второй раз её не отправить и окно не закрыть:
// иначе клиент не увидит ни номера, ни ошибки и отправит заявку заново.
let sending = false;
export const orderSending = () => sending;

export function openOrderDialog() {
  if (!state.order.length) {
    toast('Добавьте в заявку хотя бы одну позицию.');
    return;
  }
  if (orderHasProblems()) return;
  const companies = [...new Set(state.order.map(line => line.company))].join(', ');
  $('#order-summary').textContent = `${state.order.length} ${plural(state.order.length, 'позиция', 'позиции', 'позиций')} на сумму ${money.format(orderTotal())}. Компания: ${companies}.`;
  $('#dialog-demo-note').hidden = Boolean(apiUrl());
  $('#order-error').hidden = true;
  $('#order-confirm').hidden = false;
  $('#order-sent').hidden = true;
  $('#order-dialog').showModal();
}

// Заявка уходит в Apps Script (doPost), а он пересылает её менеджеру в Telegram.
// Тело — строка без заголовка Content-Type: так браузер не делает CORS-предзапрос.
// Персональные данные не передаются: только номер, компания и позиции.
export async function submitOrder() {
  if (sending) return;
  sending = true;
  const form = $('#order-form');
  const button = form.querySelector('[value=submit]');
  const error = $('#order-error');
  const payload = {
    action: 'order',
    password: accessPassword(),
    website: new FormData(form).get('website'),
    catalogVersion: state.data.version,
    total: orderTotal(),
    lines: state.order.map(line => ({
      company: line.company,
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      urgency: urgencyLabels[line.urgency],
      unitPrice: line.unitPrice,
      total: line.total,
      condition: line.status === 'good' ? '' : conditionLabels[line.status]
    }))
  };

  button.disabled = true;
  button.textContent = 'Отправляем…';
  $('#close-order-dialog').disabled = true;
  // Та же таблица, что скачивает клиент, — менеджер получит её файлом вместе с заявкой.
  // Без файла заявка всё равно уйдёт: текст сообщения содержит все позиции.
  try {
    payload.file = await orderFileBase64();
  } catch (reason) {
    console.warn('Excel к заявке не приложен:', reason);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  error.hidden = true;
  try {
    const response = await fetch(apiUrl(), {
      method: 'POST',
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Сервер ответил с кодом ${response.status}`);
    const result = await response.json();
    if (!result?.ok) {
      // Отказ сервера (например, неверный пароль) Apps Script пишет словами клиента.
      const refusal = new Error(result?.error?.code ?? 'ORDER_REJECTED');
      refusal.reason = result?.error?.message;
      throw refusal;
    }

    // Номер выдаёт Apps Script по листу «Заявки»: FB-0001 от 09.11.2026, FB-0002 от …
    const number = String(result.number ?? '');
    // Отправленная заявка очищается сразу, вместе с сохранённой в браузере копией:
    // иначе после перезагрузки она восстановится и уйдёт менеджеру второй раз.
    state.order = [];
    resetOrderFilters();
    loadOrders();
    $('#order-number').textContent = number;
    $('#order-confirm').hidden = true;
    $('#order-sent').hidden = false;
    $('#order-done').focus();
  } catch (reason) {
    console.warn('Заявка не отправлена:', reason);
    error.textContent = `Заявка не отправлена: ${failureReason(reason).toLocaleLowerCase('ru-RU')}. Попробуйте ещё раз. Если не получится, скачайте Excel и отправьте его менеджеру.`;
    error.hidden = false;
  } finally {
    clearTimeout(timeout);
    sending = false;
    $('#close-order-dialog').disabled = false;
    button.disabled = false;
    button.textContent = 'Отправить';
  }
}
