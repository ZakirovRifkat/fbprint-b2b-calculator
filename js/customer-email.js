// «Создать письмо заказчику» на вкладке «Заявки» — только у администратора.
// Админ отмечает заявки, сервер пишет письмо «Прошу согласовать заявки и макеты» со ссылками на папки макетов
// и отправляет его на CUSTOMER_EMAIL_TO. Ссылки сервер берёт с листа «Заявки», а не из запроса.
import { state } from './state.js';
import { $, cell } from './format.js';
import { accessErrors } from './auth.js';
import { loadData } from './load.js';
import { toast } from './toast.js';
import { adminErrorText, layoutsView, postAction } from './admin.js';
import { dateTime, renderOrders } from './orders.js';

// Тот же адрес — в apps-script/Code.gs (CUSTOMER_EMAIL_TO).
export const CUSTOMER_EMAIL_TO = 'info@fb-print.ru';

const selected = new Set();
let sending = false;

// Ссылка на папку макетов, если её можно отправить; иначе — почему нельзя.
export function emailFolder(entry) {
  const view = layoutsView(entry.layouts);
  if (view?.url) return { url: view.url, note: '' };
  return { url: '', note: view ? view.text : 'Папки макетов нет' };
}

const pickable = () => state.ordersList.filter(entry => emailFolder(entry).url);

function plural(count) {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return 'заявок';
  if (count % 10 === 1) return 'заявка';
  if (count % 10 >= 2 && count % 10 <= 4) return 'заявки';
  return 'заявок';
}

function renderList() {
  const list = $('#customer-email-list');
  list.replaceChildren(...state.ordersList.map(entry => {
    const folder = emailFolder(entry);
    const item = document.createElement('li');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = entry.number;
    box.checked = selected.has(entry.number);
    box.disabled = !folder.url || sending;
    box.addEventListener('change', () => {
      if (box.checked) selected.add(entry.number);
      else selected.delete(entry.number);
      renderSummary();
    });
    const sentAt = new Date(entry.sentAt);
    const text = document.createElement('span');
    text.className = 'email-order-text';
    text.append(
      cell('strong', entry.number),
      cell('span', [Number.isNaN(sentAt.getTime()) ? '' : dateTime.format(sentAt), entry.company].filter(Boolean).join(' · '))
    );
    if (folder.note) text.append(cell('small', folder.note));
    label.append(box, text);
    if (!folder.url) label.classList.add('is-disabled');
    item.append(label);
    return item;
  }));
  if (!state.ordersList.length) list.replaceChildren(cell('li', 'Заявок пока нет.', 'empty'));
  renderSummary();
}

function renderSummary() {
  // Выбор не может пережить удаление заявки или пропажу папки.
  const allowed = new Set(pickable().map(entry => entry.number));
  [...selected].forEach(number => { if (!allowed.has(number)) selected.delete(number); });
  const count = selected.size;
  $('#customer-email-count').textContent = count ? `Выбрано: ${count} ${plural(count)}` : 'Ничего не выбрано';
  const all = $('#customer-email-all');
  const everything = allowed.size > 0 && count === allowed.size;
  all.textContent = everything ? 'Снять все' : 'Выбрать все';
  all.hidden = !allowed.size;
  all.disabled = sending;
  $('#customer-email-send').disabled = sending || !count;
}

function setSending(busy) {
  sending = busy;
  $('#customer-email-send').ariaBusy = String(busy);
  $('#customer-email-send-label').textContent = busy ? 'Отправляем…' : 'Отправить письмо';
  $('#customer-email-cancel').disabled = busy;
  $('#close-customer-email').disabled = busy;
  renderList();
}

export function openCustomerEmail() {
  selected.clear();
  $('#customer-email-note').textContent = `Отметьте заявки. Письмо «Прошу согласовать заявки и макеты» со ссылками на папки макетов уйдёт на ${CUSTOMER_EMAIL_TO}. Заявки без готовой папки выбрать нельзя.`;
  $('#customer-email-error').hidden = true;
  setSending(false);
  $('#customer-email-dialog').showModal();
}

async function send() {
  if (sending || !selected.size) return;
  // В письме заявки идут в порядке списка: новые сверху.
  const numbers = state.ordersList.map(entry => entry.number).filter(number => selected.has(number));
  $('#customer-email-error').hidden = true;
  setSending(true);
  try {
    const reply = await postAction('sendCustomerEmail', { numbers }, 30000);
    setSending(false);
    $('#customer-email-dialog').close();
    const count = reply.numbers?.length ?? numbers.length;
    toast(`Письмо отправлено на ${reply.to || CUSTOMER_EMAIL_TO}: ${count} ${plural(count)}.`);
  } catch (error) {
    setSending(false);
    // Пароль сменили, пока страница была открыта: загрузка каталога заново покажет окно входа.
    if (accessErrors.includes(error.code)) {
      $('#customer-email-dialog').close();
      loadData();
      return;
    }
    if (error.code === 'ADMIN_REQUIRED') {
      $('#customer-email-dialog').close();
      renderOrders();
      toast(adminErrorText(error, 'Письмо не отправлено'), { persist: true });
      return;
    }
    $('#customer-email-error').textContent = adminErrorText(error, 'Письмо не отправлено');
    $('#customer-email-error').hidden = false;
  }
}

export function initCustomerEmail() {
  $('#customer-email').addEventListener('click', openCustomerEmail);
  $('#customer-email-all').addEventListener('click', () => {
    const allowed = pickable().map(entry => entry.number);
    if (selected.size === allowed.length) selected.clear();
    else allowed.forEach(number => selected.add(number));
    renderList();
  });
  $('#customer-email-form').addEventListener('submit', event => {
    event.preventDefault();
    send();
  });
  const close = () => { if (!sending) $('#customer-email-dialog').close(); };
  $('#customer-email-cancel').addEventListener('click', close);
  $('#close-customer-email').addEventListener('click', close);
  $('#customer-email-dialog').addEventListener('cancel', event => {
    if (sending) event.preventDefault();
  });
}

// Список заявок обновился (фоновая загрузка, удаление) — окно показывает свежий.
export function refreshCustomerEmail() {
  if ($('#customer-email-dialog')?.open) renderList();
}
