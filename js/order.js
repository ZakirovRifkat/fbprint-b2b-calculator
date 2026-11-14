// Заявка: строки, пересчёт цен, фильтры, страницы, итог и нижняя полоса.
import { state } from './state.js';
import { $, cell, createId, fitText, integer, money, plural, roundMoney } from './format.js';
import { freeDeliveryFrom, minimumValid, quote, urgencyLabels } from './pricing.js';
import { categories } from './catalog.js';
import { lineKey, renderCalculation, renderSearch, searchKey } from './calculator.js';
import { toast } from './toast.js';
import { confirmAction } from './confirm.js';

// Заявка хранится в браузере: перезагрузка и закрытие вкладки её не стирают.
export const orderKey = 'fbprint-order';

// Заявка хранится между заходами, а цены в таблице меняются.
// После загрузки каталога каждая строка пересчитывается по текущим правилам.
// Строку, которую больше нельзя заказать, помечаем: заявку с ней не отправить.
export function repriceOrder() {
  if (!state.data.companies.length || !state.order.length) return;
  let changed = 0;
  state.order.forEach(line => {
    const item = state.data.articles.find(entry => lineKey(entry) === line.key);
    const category = item && categories().get(item.categoryId);
    if (!category) {
      line.problem = { label: 'Нет в каталоге', hint: 'Удалите позицию или спросите менеджера FB-print.' };
      return;
    }
    const result = quote(line.quantity, category, line.quantity < category.minimumQuantity ? 'standard' : line.urgency);
    if (!result.canAdd) {
      line.problem = { label: 'Тираж мал', hint: `${result.message} Измените тираж или удалите позицию.` };
      return;
    }
    delete line.problem;
    if (result.unitPrice !== line.unitPrice || result.urgency !== line.urgency) changed += 1;
    Object.assign(line, {
      name: item.name,
      size: category.size,
      urgency: result.urgency,
      unitPrice: result.unitPrice,
      total: roundMoney(line.quantity * result.unitPrice),
      status: result.status
    });
  });
  const problems = state.order.filter(line => line.problem).length;
  if (problems) {
    toast(`${problems} ${plural(problems, 'позицию', 'позиции', 'позиций')} в заявке нельзя заказать: причина указана в строке.`, { persist: true });
  } else if (changed) {
    toast(`Цены в заявке обновлены: ${changed} ${plural(changed, 'позиция', 'позиции', 'позиций')}.`, { persist: true });
  }
}

// Отправить и скачать заявку можно, только если каждую строку можно заказать.
export function orderHasProblems() {
  if (!state.order.some(line => line.problem)) return false;
  toast('В заявке есть позиции, которые нельзя заказать. Исправьте или удалите их.', { persist: true });
  return true;
}

export function lineNote(line) {
  if (line.problem) return { ...line.problem, tone: 'danger' };
  if (line.status !== 'reduced' && line.status !== 'multiple') return null;
  const item = state.data.articles.find(entry => lineKey(entry) === line.key);
  const category = item && categories().get(item.categoryId);
  if (!category) return null;
  return line.status === 'reduced'
    ? { label: 'Сниженный тираж', hint: `От ${integer.format(minimumValid(category))} шт. — ${money.format(category.prices.standard)} за штуку` }
    : { label: 'Не кратен', hint: `Кратность ${integer.format(category.multiple)} шт.` };
}

export function makeLine(item, value, result) {
  const category = categories().get(item.categoryId);
  const company = state.data.companies.find(entry => entry.id === item.companyId);
  return {
    id: createId(),
    key: lineKey(item),
    company: company.name,
    sku: item.sku,
    name: item.name,
    size: category.size,
    quantity: value,
    urgency: result.urgency,
    unitPrice: result.unitPrice,
    total: roundMoney(value * result.unitPrice),
    status: result.status
  };
}

// Тираж меняется прямо в заявке: цена и пометки пересчитываются по тем же правилам, что в калькуляторе.
// Тираж ниже минимального заказа не принимается — остаётся прежний.
export function changeLineQuantity(line, input) {
  const value = Math.max(0, Number(String(input.value).replace(/\D/g, '')) || 0);
  const item = state.data.articles.find(entry => lineKey(entry) === line.key);
  const category = item && categories().get(item.categoryId);
  const restore = () => { input.value = integer.format(line.quantity); };
  if (!category) {
    toast('Артикула больше нет в каталоге, тираж не изменить.', { persist: true });
    restore();
    return;
  }
  if (value === line.quantity) {
    restore();
    return;
  }
  const result = quote(value, category, value < category.minimumQuantity ? 'standard' : line.urgency);
  if (!result.canAdd) {
    toast(`${result.message} Тираж не изменён.`, { persist: true });
    restore();
    return;
  }
  const urgencyDropped = result.urgency !== line.urgency;
  state.flashLineId = line.id;
  delete line.problem;
  Object.assign(line, {
    quantity: value,
    urgency: result.urgency,
    unitPrice: result.unitPrice,
    total: roundMoney(value * result.unitPrice),
    status: result.status
  });
  renderOrder();
  toast(urgencyDropped
    ? 'Тираж меньше минимального: срок изменён на стандартный.'
    : { good: 'Тираж изменён.', reduced: 'Тираж изменён: цена сниженного тиража.' }[result.status] ?? 'Тираж изменён. Проверьте кратность.');
}

// Фильтры и сортировка таблицы заявки. Порядок по умолчанию — порядок добавления.
export const orderFilter = { query: '', company: '', urgency: '', issue: '' };
export const urgencyRank = { standard: 0, urgent: 1, emergency: 2 };
export const sortValue = {
  code: line => `${line.company} ${line.sku.padStart(12, '0')}`,
  name: line => line.name,
  quantity: line => line.quantity,
  urgency: line => urgencyRank[line.urgency],
  price: line => line.unitPrice,
  total: line => line.total
};

export function filtersActive() {
  return Object.values(orderFilter).some(Boolean);
}

export function visibleOrder() {
  const query = searchKey(orderFilter.query);
  const list = state.order.filter(line => {
    if (query && !searchKey(`${line.sku} ${line.name}`).includes(query)) return false;
    if (orderFilter.company && line.company !== orderFilter.company) return false;
    if (orderFilter.urgency && line.urgency !== orderFilter.urgency) return false;
    if (orderFilter.issue === 'issues' && line.status !== 'reduced' && line.status !== 'multiple') return false;
    if ((orderFilter.issue === 'reduced' || orderFilter.issue === 'multiple') && line.status !== orderFilter.issue) return false;
    return true;
  });
  if (!state.orderSort.key) return list;
  const value = sortValue[state.orderSort.key];
  // Сортировка устойчивая: при равных значениях сохраняется порядок добавления.
  return list
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const x = value(a.line);
      const y = value(b.line);
      const compare = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ru', { numeric: true });
      return compare * state.orderSort.dir || a.index - b.index;
    })
    .map(item => item.line);
}

export function renderOrderTools(shownCount) {
  const tools = $('#order-tools');
  tools.hidden = state.order.length < 6 && !filtersActive();
  const companies = [...new Set(state.order.map(line => line.company))];
  const companySelect = $('#order-filter-company');
  const current = companySelect.value;
  companySelect.innerHTML = '<option value="">Все компании</option>';
  companies.forEach(name => companySelect.append(new Option(name, name)));
  companySelect.value = companies.includes(current) ? current : '';
  orderFilter.company = companySelect.value;
  companySelect.hidden = companies.length < 2;
  ['#order-filter-company', '#order-filter-urgency', '#order-filter-issue'].forEach(selector => $(selector).classList.toggle('is-active', Boolean($(selector).value)));
  $('#order-filter-reset').hidden = !filtersActive();
  $('#order-none').hidden = shownCount > 0 || !state.order.length;
  document.querySelectorAll('.order-table th[data-sort]').forEach(th => {
    if (th.dataset.sort === state.orderSort.key) th.setAttribute('aria-sort', state.orderSort.dir > 0 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
  const sortSelect = $('#order-sort-select');
  const sortCode = state.orderSort.key ? `${state.orderSort.key}:${state.orderSort.dir}` : '';
  if ([...sortSelect.options].some(option => option.value === sortCode)) sortSelect.value = sortCode;
}

export function clearOrderFilters() {
  Object.keys(orderFilter).forEach(key => { orderFilter[key] = ''; });
  $('#order-search').value = '';
  ['#order-filter-company', '#order-filter-urgency', '#order-filter-issue'].forEach(selector => { $(selector).value = ''; });
}

export function resetOrderFilters() {
  clearOrderFilters();
  state.orderPage = 1;
  renderOrder();
}

// Новая позиция должна быть видна: фильтры сбрасываются, открывается страница, где она стоит с учётом сортировки.
export function showLine(line) {
  clearOrderFilters();
  const index = visibleOrder().indexOf(line);
  state.orderPage = state.orderPageSize ? Math.floor(index / state.orderPageSize) + 1 : 1;
}

// Таблица заявки — по страницам: 10 позиций по умолчанию, можно 25, 50 или все сразу.
// Строка, где только что изменили тираж: на секунду подсвечивается, чтобы было видно, что сумма пересчиталась.

export function orderPageCount(count = visibleOrder().length) {
  return state.orderPageSize ? Math.max(1, Math.ceil(count / state.orderPageSize)) : 1;
}

// Номера страниц: первая, последняя и соседние с текущей, между ними — многоточие.
export function pagerItems(current, total) {
  const pages = [...new Set([1, current - 1, current, current + 1, total])].filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
  return pages.flatMap((page, index) => (index && page - pages[index - 1] > 1 ? ['…', page] : [page]));
}

export function renderPager(shownCount) {
  const pager = $('#order-pager');
  pager.hidden = state.order.length <= 10 || !shownCount;
  if (pager.hidden) return;
  const total = orderPageCount(shownCount);
  const first = state.orderPageSize ? (state.orderPage - 1) * state.orderPageSize + 1 : 1;
  const last = state.orderPageSize ? Math.min(shownCount, state.orderPage * state.orderPageSize) : shownCount;
  $('#order-range').textContent = `Позиции ${first}–${last} из ${shownCount}${shownCount < state.order.length ? ` (всего ${state.order.length})` : ''}`;
  const root = $('#order-pages');
  root.innerHTML = '';
  if (total < 2) return;
  const button = (label, page, current = false) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    item.disabled = page < 1 || page > total;
    if (current) item.setAttribute('aria-current', 'page');
    item.ariaLabel = label === '‹' ? 'Предыдущая страница' : label === '›' ? 'Следующая страница' : `Страница ${page}`;
    item.addEventListener('click', () => {
      state.orderPage = page;
      renderOrder();
    });
    return item;
  };
  root.append(button('‹', state.orderPage - 1));
  pagerItems(state.orderPage, total).forEach(item => root.append(item === '…' ? cell('span', '…') : button(String(item), item, item === state.orderPage)));
  root.append(button('›', state.orderPage + 1));
}

export function readSavedOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(orderKey) ?? '[]');
    return Array.isArray(saved) ? saved.filter(line => line?.id && line.key && Number(line.quantity) > 0) : [];
  } catch {
    return [];
  }
}

export function saveOrder() {
  try {
    localStorage.setItem(orderKey, JSON.stringify(state.order));
  } catch {
    // Хранилище недоступно (приватный режим) — заявка живёт до закрытия вкладки.
  }
}

// Удаление строки — как в окне проверки Excel: крестик слева, подтверждение, потом тост «Вернуть».
async function removeLineWithConfirm(line) {
  const buttons = () => [...$('#order-lines').querySelectorAll('.line-remove')];
  const index = buttons().findIndex(button => button.dataset.key === line.key);
  const confirmed = await confirmAction({
    title: 'Удалить позицию?',
    message: `Артикул ${line.sku} — ${line.name}. Позиция пропадёт из заявки.`,
    confirmLabel: 'Удалить'
  });
  if (!confirmed) {
    buttons()[index]?.focus();
    return;
  }
  removeLines([line], `Артикул ${line.sku} удалён из заявки.`);
  // Фокус — на крестик строки, вставшей на место удалённой, иначе на «Вернуть» в тосте.
  (buttons()[index] ?? buttons().at(-1) ?? $('#toast-action'))?.focus();
}

// Очистка всей заявки — тоже через подтверждение. После неё фокус на «Вернуть» в тосте:
// кнопка очистки исчезает вместе со строками.
export async function clearOrderWithConfirm() {
  const count = state.order.length;
  if (!count) return;
  const sum = roundMoney(state.order.reduce((total, line) => total + line.total, 0));
  const confirmed = await confirmAction({
    title: 'Очистить заявку?',
    message: `${count} ${plural(count, 'позиция', 'позиции', 'позиций')} на ${money.format(sum)} ${plural(count, 'пропадёт', 'пропадут', 'пропадут')} из заявки.`,
    confirmLabel: 'Очистить'
  });
  if (!confirmed) {
    $('#clear-order').focus();
    return;
  }
  removeLines(state.order.slice(), 'Заявка очищена.');
  $('#toast-action').focus();
}

// Удаление обратимо: тост предлагает вернуть позиции на прежние места.
export function removeLines(lines, message) {
  const removed = state.order.map((line, index) => ({ line, index })).filter(({ line }) => lines.includes(line));
  state.order = state.order.filter(line => !lines.includes(line));
  renderOrder();
  toast(message, {
    action: 'Вернуть',
    onAction: () => {
      removed.forEach(({ line, index }) => {
        if (!state.order.some(item => item.key === line.key)) state.order.splice(Math.min(index, state.order.length), 0, line);
      });
      renderOrder();
    }
  });
}

export function renderOrder() {
  saveOrder();
  const empty = $('#order-empty');
  const root = $('#order-lines');
  empty.hidden = state.order.length > 0;
  root.innerHTML = '';

  $('#order-table').hidden = !state.order.length;
  const shown = visibleOrder();
  state.orderPage = Math.min(Math.max(1, state.orderPage), orderPageCount(shown.length));
  const visible = state.orderPageSize ? shown.slice((state.orderPage - 1) * state.orderPageSize, state.orderPage * state.orderPageSize) : shown;
  // Строка таблицы: удалить, компания и код, наименование, тираж (можно изменить), срок, цена за штуку, сумма.
  visible.forEach(line => {
    const row = document.createElement('tr');
    const code = cell('td', line.sku, 'code');
    code.prepend(cell('small', line.company));

    const quantity = document.createElement('td');
    quantity.className = 'num';
    quantity.dataset.cell = 'quantity';
    const quantityInput = document.createElement('input');
    quantityInput.className = 'line-quantity-input';
    quantityInput.inputMode = 'numeric';
    quantityInput.value = integer.format(line.quantity);
    quantityInput.ariaLabel = `Тираж артикула ${line.sku}`;
    quantityInput.addEventListener('change', () => changeLineQuantity(line, quantityInput));
    quantityInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') quantityInput.blur();
    });
    quantity.append(quantityInput);
    // Тираж не оптимальный — ярлык под полем, как в окне проверки. Подробность — во всплывающей подсказке.
    const note = lineNote(line);
    if (note) {
      const tag = cell('span', note.label);
      tag.className = `line-tag line-tag--${note.tone ?? 'warn'}`;
      tag.title = note.hint;
      quantity.append(tag);
    }

    const urgency = document.createElement('td');
    urgency.dataset.cell = 'urgency';
    const urgencyLabel = cell('span', urgencyLabels[line.urgency]);
    // Обычный срок — серым текстом, срочный и экстренный — ярлыком: они дороже и требуют подтверждения.
    if (line.urgency !== 'standard') urgencyLabel.className = `line-tag line-tag--${line.urgency}`;
    urgency.append(urgencyLabel);

    const price = cell('td', money.format(line.unitPrice), 'price');
    price.className = 'num';
    const total = cell('td', money.format(line.total), 'total');
    total.className = 'num';

    const removeCell = document.createElement('td');
    removeCell.dataset.cell = 'remove';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'line-remove';
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    remove.dataset.key = line.key;
    remove.title = 'Удалить позицию';
    remove.ariaLabel = `Удалить артикул ${line.sku}`;
    remove.addEventListener('click', () => removeLineWithConfirm(line));
    removeCell.append(remove);

    row.append(removeCell, code, cell('td', line.name, 'name'), quantity, urgency, price, total);
    if (line.id === state.flashLineId) row.className = 'line-flash';
    root.append(row);
  });

  state.flashLineId = null;
  renderOrderTools(shown.length);
  renderPager(shown.length);
  $('#order-total').textContent = money.format(orderTotal());
  fitText($('#order-total'));
  const delivery = $('#delivery-note');
  delivery.hidden = !state.order.length;
  delivery.dataset.free = String(orderTotal() >= freeDeliveryFrom);
  delivery.textContent = deliveryText();
  $('#order-counter').textContent = state.order.length
    ? `${state.order.length} ${plural(state.order.length, 'позиция', 'позиции', 'позиций')}`
    : 'Пока нет позиций';
  // Кнопка «Добавить» и пометки «Уже в заявке» зависят от состава заявки.
  renderCalculation();
  if (!$('#search-results').hidden) renderSearch($('#article-search').value);
  $('#clear-order').hidden = !state.order.length;
  renderDock();
}

// Полоса с итогом внизу экрана — пока в заявке есть позиции, а её собственный итог не виден.
export function renderDock() {
  const visible = state.order.length > 0 && !state.orderFooterVisible && location.hash !== '#orders';
  const dock = $('#order-dock');
  dock.dataset.visible = String(visible);
  dock.inert = !visible;
  document.body.dataset.dock = String(visible);
  $('#order-dock-count').textContent = `${state.order.length} ${plural(state.order.length, 'позиция', 'позиции', 'позиций')}`;
  $('#order-dock-total').textContent = money.format(orderTotal());
}

export function orderTotal() {
  return roundMoney(state.order.reduce((sum, line) => sum + line.total, 0));
}

// Правило из примечаний листа «Категории»: «Бесплатная доставка — при сумме счёта от 100 тыс. руб.».
export function deliveryText() {
  const total = orderTotal();
  return total >= freeDeliveryFrom
    ? `Доставка бесплатная от ${money.format(freeDeliveryFrom)}.`
    : `До бесплатной доставки — ${money.format(roundMoney(freeDeliveryFrom - total))}. Сейчас доставка платная или самовывоз.`;
}
