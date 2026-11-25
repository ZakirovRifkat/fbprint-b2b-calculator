// «Создать письмо заказчику» на вкладке «Заявки» — только у администратора.
// Админ отмечает заявки, пишет обращение и плановую дату отгрузки. Сайт собирает таблицу каждой заявки
// (как «Скачать Excel»), сервер пишет письмо по шаблону менеджера со ссылками на папки макетов, прикладывает
// таблицы и отправляет на CUSTOMER_EMAIL_TO. Ссылки сервер берёт с листа «Заявки», а не из запроса.
import { state } from './state.js';
import { $, cell } from './format.js';
import { accessErrors } from './auth.js';
import { loadData } from './load.js';
import { toast } from './toast.js';
import { adminErrorText, layoutsView, postAction } from './admin.js';
import { dateTime, orderLinesFor, renderOrders } from './orders.js';
import { orderFileBase64 } from './excel.js';

// Тот же адрес и предел — в apps-script/Code.gs (CUSTOMER_EMAIL_TO, CUSTOMER_EMAIL_MAX).
export const CUSTOMER_EMAIL_TO = 'info@fb-print.ru';
export const CUSTOMER_EMAIL_MAX = 20;
const GREETING_KEY = 'fbprint-email-greeting';
const DEFAULT_GREETING = 'Светлана';
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

const selected = new Set();
let sending = false;

// Ссылка на папку макетов, если её можно отправить; иначе — почему нельзя.
export function emailFolder(entry) {
  const view = layoutsView(entry.layouts);
  if (view?.url) return { url: view.url, note: '' };
  return { url: '', note: view ? view.text : 'Папки макетов нет' };
}

// '2026-11-27' → '27/11 (пятница)', как в письме; неверная дата — ''.
export function shipDateText(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCDate() !== Number(match[3]) || date.getUTCMonth() !== Number(match[2]) - 1) return '';
  return `${match[3]}/${match[2]} (${WEEKDAYS[date.getUTCDay()]})`;
}

const pickable = () => state.ordersList.filter(entry => emailFolder(entry).url);

function plural(count) {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return 'заявок';
  if (count % 10 === 1) return 'заявка';
  if (count % 10 >= 2 && count % 10 <= 4) return 'заявки';
  return 'заявок';
}

function savedGreeting() {
  try {
    return localStorage.getItem(GREETING_KEY) || DEFAULT_GREETING;
  } catch {
    return DEFAULT_GREETING;
  }
}

function rememberGreeting(value) {
  try {
    localStorage.setItem(GREETING_KEY, value);
  } catch {
    // Хранилище недоступно — в следующий раз будет обращение по умолчанию.
  }
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
  const over = count > CUSTOMER_EMAIL_MAX;
  $('#customer-email-count').textContent = count
    ? `Выбрано: ${count} ${plural(count)}${over ? ` — в одном письме не больше ${CUSTOMER_EMAIL_MAX}` : ''}`
    : 'Ничего не выбрано';
  $('#customer-email-count').classList.toggle('is-over', over);
  const all = $('#customer-email-all');
  const everything = allowed.size > 0 && count === allowed.size;
  all.textContent = everything ? 'Снять все' : 'Выбрать все';
  all.hidden = !allowed.size;
  all.disabled = sending;
  $('#customer-email-send').disabled = sending || !count || over;
}

function renderShipDate() {
  const text = shipDateText($('#customer-email-ship').value);
  $('#customer-email-ship-text').textContent = text ? `В письме: «${text}»` : 'В письме: «27/11 (пятница)»';
}

function setSending(step) {
  sending = Boolean(step);
  $('#customer-email-send').ariaBusy = String(sending);
  $('#customer-email-send-label').textContent = step === 'files' ? 'Готовим таблицы…' : step === 'send' ? 'Отправляем…' : 'Отправить письмо';
  ['#customer-email-cancel', '#close-customer-email', '#customer-email-greeting', '#customer-email-ship'].forEach(id => { $(id).disabled = sending; });
  renderList();
}

function showError(message, focus) {
  $('#customer-email-error').textContent = message;
  $('#customer-email-error').hidden = false;
  focus?.focus();
}

export function openCustomerEmail() {
  selected.clear();
  $('#customer-email-note').textContent = `Отметьте заявки и укажите плановую дату отгрузки. Письмо уйдёт на ${CUSTOMER_EMAIL_TO}: таблицы заявок во вложении, ссылки на папки макетов в тексте. Заявки без готовой папки выбрать нельзя.`;
  $('#customer-email-greeting').value = savedGreeting();
  $('#customer-email-ship').value = '';
  renderShipDate();
  $('#customer-email-error').hidden = true;
  setSending('');
  $('#customer-email-dialog').showModal();
}

// Таблица каждой заявки — те же листы и столбцы, что у «Скачать Excel». Позиций нет — письмо не собрать.
async function orderFiles(numbers) {
  const files = {};
  for (const number of numbers) {
    let lines;
    try {
      lines = await orderLinesFor(number);
    } catch (error) {
      console.warn(`Позиции заявки ${number} не загружены:`, error);
      throw Object.assign(new Error(), { reason: `Не удалось загрузить позиции заявки ${number}. Попробуйте ещё раз` });
    }
    if (!lines.length) throw Object.assign(new Error(), { reason: `У заявки ${number} нет сохранённых позиций — таблицу не собрать` });
    files[number] = await orderFileBase64(lines);
  }
  return files;
}

async function send() {
  if (sending || !selected.size) return;
  $('#customer-email-error').hidden = true;
  const greeting = $('#customer-email-greeting').value.trim();
  const shipDate = $('#customer-email-ship').value;
  if (!greeting) return showError('Укажите, к кому обращаемся в письме.', $('#customer-email-greeting'));
  if (!shipDateText(shipDate)) return showError('Укажите плановую дату отгрузки.', $('#customer-email-ship'));
  // В письме заявки идут от старых к новым, как их перечисляет менеджер: FB-0022, 0023, 0024.
  const numbers = state.ordersList.map(entry => entry.number).filter(number => selected.has(number)).reverse();
  setSending('files');
  try {
    const files = await orderFiles(numbers);
    setSending('send');
    const reply = await postAction('sendCustomerEmail', { numbers, shipDate, greeting, files }, 60000);
    rememberGreeting(greeting);
    setSending('');
    $('#customer-email-dialog').close();
    const count = reply.numbers?.length ?? numbers.length;
    toast(`Письмо отправлено на ${reply.to || CUSTOMER_EMAIL_TO}: ${count} ${plural(count)}.`);
  } catch (error) {
    setSending('');
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
    // Ошибки сборки таблиц и проверки на сервере — текстом как есть, остальное — с причиной.
    const message = !error.code && error.reason ? error.reason
      : error.code === 'EMAIL_INVALID' ? error.reason
        : adminErrorText(error, 'Письмо не отправлено');
    showError(message);
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
  $('#customer-email-ship').addEventListener('input', renderShipDate);
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
