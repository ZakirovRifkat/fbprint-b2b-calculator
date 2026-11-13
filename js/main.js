// Запуск: начальное состояние, обработчики событий, первая загрузка.
import { state } from './state.js';
import { $, fitText } from './format.js';
import { stepQuantity } from './pricing.js';
import { categories, demoCatalog, emptyCatalog, normalizeCatalog } from './catalog.js';
import { rememberPassword, setLoginBusy, showPassword } from './auth.js';
import { apiUrl, applyCatalog, loadData } from './load.js';
import { addLine, hideSearch, quantity, renderCalculation, renderSearch, renderSelected, setQuantity } from './calculator.js';
import { clearOrderWithConfirm, orderFilter, readSavedOrder, renderDock, renderOrder, resetOrderFilters } from './order.js';
import { addImportedLines, evaluateImportRow, fixable, importFile, renderImport, restoreImportRow } from './import.js';
import { loadOrders, renderOrders, showView } from './orders.js';
import { openOrderDialog, submitOrder } from './submit.js';
import { downloadExcel } from './excel.js';
import { hideToast, restartToastTimer, toast } from './toast.js';
import { initConfirm } from './confirm.js';

// Раньше заявки хранились в браузере; теперь они в таблице, старую копию убираем.
try {
  localStorage.removeItem('fbprint-sent-orders');
} catch {
  // Хранилище недоступно — убирать нечего.
}

// Без адреса Apps Script сайт работает на демо-каталоге. Заявка восстанавливается из браузера.
state.data = apiUrl() ? emptyCatalog : normalizeCatalog(demoCatalog);
state.companyId = state.data.companies[0]?.id ?? '';
state.order = readSavedOrder();

$('#toast').addEventListener('mouseenter', () => clearTimeout(toast.timer));
$('#toast').addEventListener('focusin', () => clearTimeout(toast.timer));
$('#toast').addEventListener('mouseleave', restartToastTimer);
$('#toast').addEventListener('focusout', restartToastTimer);
$('#toast-action').addEventListener('click', () => {
  const action = toast.onAction;
  hideToast();
  action?.();
});
$('#toast-close').addEventListener('click', hideToast);

$('#article-search').addEventListener('input', event => renderSearch(event.target.value));
$('#article-search').addEventListener('focus', event => renderSearch(event.target.value));
$('#article-search').addEventListener('click', event => renderSearch(event.target.value));
document.addEventListener('click', event => {
  if (!event.target.closest('.search-wrap')) hideSearch();
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase('ru-RU') === 'k') {
    event.preventDefault();
    $('#article-search').focus();
  }
});
$('#company-switch').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll('button')];
  const current = buttons.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
  const next = buttons[(current + direction + buttons.length) % buttons.length];
  next.focus();
  next.click();
  next.focus();
});
$('#change-product').addEventListener('click', () => {
  state.article = null;
  renderSelected();
  $('#article-search').focus();
});
$('#quantity').addEventListener('input', renderCalculation);
$('#quantity').addEventListener('blur', () => {
  setQuantity(quantity());
  renderCalculation();
});
$('#quantity-minus').addEventListener('click', () => {
  if (!state.article) return;
  setQuantity(stepQuantity(quantity(), categories().get(state.article.categoryId), -1));
  renderCalculation();
});
$('#quantity-plus').addEventListener('click', () => {
  if (!state.article) return;
  setQuantity(stepQuantity(quantity(), categories().get(state.article.categoryId), 1));
  renderCalculation();
});
document.querySelectorAll('[name=urgency]').forEach(input => {
  input.addEventListener('change', renderCalculation);
});
$('#add-line').addEventListener('click', addLine);
$('#import-file-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', event => {
  importFile(event.target.files[0]);
  event.target.value = '';
});
// Перетаскивание файла на зону загрузки. Счётчик нужен, потому что dragleave срабатывает и на вложенных элементах.
let dragDepth = 0;
const dropZone = $('#import-drop');
const hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files');
dropZone.addEventListener('dragenter', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  dropZone.dataset.drag = 'true';
});
dropZone.addEventListener('dragover', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
dropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) delete dropZone.dataset.drag;
});
dropZone.addEventListener('drop', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  delete dropZone.dataset.drag;
  importFile(event.dataTransfer.files[0]);
});
// Файл, брошенный мимо зоны, браузер открыл бы вместо сайта — гасим это.
window.addEventListener('dragover', event => {
  if (hasFiles(event)) event.preventDefault();
});
window.addEventListener('drop', event => {
  if (hasFiles(event) && !event.target.closest?.('#import-drop')) event.preventDefault();
});
$('#import-fix-all').addEventListener('click', () => {
  state.importRows.forEach(row => {
    const result = evaluateImportRow(row);
    if (fixable(result)) row.quantity = result.suggested;
  });
  renderImport();
});
$('#import-add').addEventListener('click', addImportedLines);
$('#import-undo-button').addEventListener('click', restoreImportRow);
initConfirm();
$('#order-search').addEventListener('input', event => {
  orderFilter.query = event.target.value;
  state.orderPage = 1;
  renderOrder();
});
[['#order-filter-company', 'company'], ['#order-filter-urgency', 'urgency'], ['#order-filter-issue', 'issue']].forEach(([selector, key]) => {
  $(selector).addEventListener('change', event => {
    orderFilter[key] = event.target.value;
    state.orderPage = 1;
    renderOrder();
  });
});
$('#order-filter-reset').addEventListener('click', resetOrderFilters);
$('#order-none-reset').addEventListener('click', resetOrderFilters);
// Клик по заголовку: по возрастанию → по убыванию → порядок добавления.
document.querySelectorAll('.order-table th[data-sort] .sort-button').forEach(button => button.addEventListener('click', () => {
  const key = button.parentElement.dataset.sort;
  state.orderSort = state.orderSort.key !== key ? { key, dir: 1 } : state.orderSort.dir > 0 ? { key, dir: -1 } : { key: '', dir: 1 };
  state.orderPage = 1;
  renderOrder();
}));
$('#order-sort-select').addEventListener('change', event => {
  const [key, dir] = event.target.value.split(':');
  state.orderSort = { key: key || '', dir: Number(dir) || 1 };
  state.orderPage = 1;
  renderOrder();
});
$('#order-page-size').addEventListener('change', event => {
  state.orderPageSize = Number(event.target.value);
  state.orderPage = 1;
  renderOrder();
});
$('#close-import-dialog').addEventListener('click', () => $('#import-dialog').close());
$('#clear-order').addEventListener('click', clearOrderWithConfirm);
$('#download-excel').addEventListener('click', downloadExcel);
$('#submit-order').addEventListener('click', openOrderDialog);
$('#order-dock-submit').addEventListener('click', openOrderDialog);
$('#order-dock-jump').addEventListener('click', () => {
  document.querySelector('.order').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});
// Полоса не должна закрывать поле, на которое перешёл фокус с клавиатуры.
document.addEventListener('focusin', event => {
  const dock = $('#order-dock');
  if (dock.dataset.visible !== 'true' || dock.contains(event.target)) return;
  const overlap = event.target.getBoundingClientRect().bottom - dock.getBoundingClientRect().top + 16;
  if (overlap > 0) window.scrollBy({ top: overlap, behavior: 'instant' });
});
new IntersectionObserver(([entry]) => {
  state.orderFooterVisible = entry.isIntersecting;
  renderDock();
}).observe(document.querySelector('.order-footer'));
$('#close-order-dialog').addEventListener('click', () => $('#order-dialog').close());
$('#order-dialog').addEventListener('click', event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
$('#order-done').addEventListener('click', () => $('#order-dialog').close());
$('#order-form').addEventListener('submit', event => {
  if (event.submitter?.value !== 'submit') return;
  event.preventDefault();
  if (apiUrl()) {
    submitOrder();
    return;
  }
  $('#order-dialog').close();
  toast('Демо-режим: заявка не отправлена менеджеру.');
});
$('#refresh-data').addEventListener('click', loadData);
$('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('#login-password').value.trim();
  if (!value) return;
  rememberPassword(value, $('#remember-password').checked);
  $('#login-error').hidden = true;
  setLoginBusy(true);
  loadData();
});
$('#toggle-password').addEventListener('click', () => {
  showPassword($('#login-password').type === 'password');
  $('#login-password').focus();
});
// Без пароля калькулятор пуст, поэтому окно входа не закрывается по Esc.
$('#login-dialog').addEventListener('cancel', event => event.preventDefault());

const refitTotals = () => ['#unit-price', '#order-total'].forEach(selector => fitText($(selector)));
document.fonts?.ready.then(refitTotals);
window.addEventListener('resize', refitTotals);

applyCatalog(state.data);
renderOrders();
showView();
window.addEventListener('hashchange', () => {
  showView();
  window.scrollTo(0, 0);
  $(location.hash === '#orders' ? '#orders-title' : '#page-title').focus({ preventScroll: true });
  if (location.hash === '#orders') loadOrders();
});
document.querySelectorAll('.orders-filter button').forEach(button => button.addEventListener('click', () => {
  state.ordersFilter = button.dataset.filter;
  renderOrders();
}));
loadData();
