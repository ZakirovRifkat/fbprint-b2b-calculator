// Заявка из Excel: разбор файла, проверка строк, окно проверки.
import { state } from './state.js';
import { $, cell, integer, money, plural, roundMoney } from './format.js';
import { minimumValid, quote, urgencyLabels } from './pricing.js';
import { categories } from './catalog.js';
import { inOrder } from './calculator.js';
import { clearOrderFilters, makeLine, renderOrder } from './order.js';
import { loadExcelJs } from './excel.js';
import { toast } from './toast.js';
import { confirmAction } from './confirm.js';

// Загрузка заявки списком: файл Excel клиента — перетаскиванием на зону или кнопкой «Выбрать файл».
// Формат таблицы свободный: сайт ищет строку заголовков с «Код» (или «Артикул») и столбец тиража
// («Тираж», «Заказ…, шт», «Количество»); название компании в заголовке задаёт компанию блока.
// Без заголовков: первый заполненный столбец — код, следующий с числом — тираж, компания — выбранная на сайте.
// Каждая строка проверяется теми же правилами, что и калькулятор (quote).
export const importLabels = {
  good: 'Подходит',
  reduced: 'Сниженный тираж',
  multiple: 'Не кратен',
  blocked: 'Меньше минимума',
  missing: 'Нет в каталоге',
  duplicate: 'Повтор',
  inOrder: 'Уже в заявке'
};

export const looseText = value => String(value ?? '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');

// Значение ячейки ExcelJS: формулы, форматированный текст и гиперссылки — к простому значению.
export function cellValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return '';
  if (typeof value === 'object') {
    if ('result' in value) return cellValue(value.result);
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
    if ('text' in value) return String(value.text);
    return '';
  }
  return value;
}

export function skuText(value) {
  return String(value ?? '').trim().replace(/\.0+$/, '');
}

export function quantityValue(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export function urgencyValue(value) {
  const key = looseText(value);
  return key.includes('экстр') ? 'emergency' : key.includes('сроч') ? 'urgent' : 'standard';
}

export function companyByName(value) {
  const key = looseText(value);
  return key ? state.data.companies.find(item => looseText(item.name) === key) ?? null : null;
}

export function guessLayout(cells) {
  const filled = cells.map((value, index) => [value, index]).filter(([value]) => String(value).trim() !== '');
  const quantity = filled.slice(1).find(([value]) => quantityValue(value) > 0);
  if (!filled.length || !quantity) return null;
  const urgency = filled.slice(1).find(([value]) => /сроч|экстр|станд/i.test(String(value)));
  return { sku: filled[0][1], quantity: quantity[1], urgency: urgency ? urgency[1] : -1, companyId: null };
}

// rows — массив строк, строка — массив значений ячеек. Возвращает позиции {companyId, sku, quantity, urgency, source}.
export function parseImportRows(rows, sourceName, fallbackCompanyId = null) {
  const items = [];
  let layout = null;
  rows.forEach((row, index) => {
    const cells = Array.from(row ?? [], cellValue);
    const keys = cells.map(looseText);
    const skuColumn = keys.findIndex(key => key === 'код' || key === 'арт' || key.startsWith('артикул') || key === 'кодтовара');
    if (skuColumn >= 0) {
      const quantity = keys.findIndex((key, column) => column !== skuColumn && /тираж|заказ|колич|колво|шт/.test(key) && !/цен|стоим|сумм/.test(key));
      const urgency = keys.findIndex((key, column) => column !== skuColumn && /срок|срочн/.test(key));
      const company = cells.map(companyByName).find(Boolean);
      layout = { sku: skuColumn, quantity, urgency, companyId: company?.id ?? fallbackCompanyId };
      return;
    }
    const current = layout ?? guessLayout(cells);
    if (!current || current.quantity < 0) return;
    const sku = skuText(cells[current.sku]);
    const quantity = quantityValue(cells[current.quantity]);
    // Строки без цифр в коде — подписи и «Итого», без тиража — пустые.
    if (!/\d/.test(sku) || !quantity) return;
    items.push({
      companyId: current.companyId ?? fallbackCompanyId,
      sku,
      quantity,
      urgency: current.urgency >= 0 ? urgencyValue(cells[current.urgency]) : 'standard',
      source: `${sourceName}строка ${index + 1}`
    });
  });
  return items;
}

export async function readImportFile(file) {
  const ExcelJS = await loadExcelJs();
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('Не удалось прочитать файл. Сохраните таблицу в формате .xlsx и попробуйте снова.');
  }
  const sheets = book.worksheets
    .filter(sheet => !sheet.state || sheet.state === 'visible')
    .map(sheet => {
      const rows = [];
      sheet.eachRow({ includeEmpty: true }, (row, number) => {
        rows[number - 1] = Array.from(row.values).slice(1);
      });
      return { name: sheet.name, rows: Array.from(rows, row => row ?? []) };
    })
    .map(sheet => ({ ...sheet, items: parseImportRows(sheet.rows, '', companyByName(sheet.name)?.id ?? null) }))
    .filter(sheet => sheet.items.length);
  // Название листа нужно в подписи строки, только если позиции нашлись на нескольких листах.
  return sheets.flatMap(sheet => sheet.items.map(item => (sheets.length > 1 ? { ...item, source: `лист «${sheet.name}», ${item.source}` } : item)));
}

// Компания строки: из заголовка таблицы, иначе — выбранная на сайте.
// Если такого кода у выбранной компании нет, но он есть ровно у одной другой — берём её.
export function prepareImport(items) {
  const selected = state.companyId;
  const seen = new Map();
  state.importRows = items.map((item, index) => {
    let rowCompany = item.companyId ?? selected;
    let note = '';
    let found = state.data.articles.find(entry => entry.companyId === rowCompany && entry.sku === item.sku) ?? null;
    if (!found && !item.companyId) {
      const elsewhere = state.data.articles.filter(entry => entry.sku === item.sku);
      if (elsewhere.length === 1) {
        found = elsewhere[0];
        rowCompany = found.companyId;
        note = 'Компания определена по артикулу';
      }
    }
    return { id: index, companyId: rowCompany, sku: item.sku, article: found, quantity: item.quantity, urgency: item.urgency, source: item.source, note, duplicateOf: null };
  });
  removedImportRows.length = 0;
  markDuplicates();
}

// Повтор — второй и следующие раз встреченный артикул. После удаления строки повторы считаются заново:
// если удалили первую, её место занимает следующая такая же.
function markDuplicates() {
  const seen = new Map();
  state.importRows.forEach(row => {
    row.duplicateOf = null;
    if (!row.article) return;
    const key = `${row.companyId}/${row.sku}`;
    if (seen.has(key)) row.duplicateOf = seen.get(key);
    else seen.set(key, row);
  });
}

// Удалённые строки — стопкой: «Вернуть» возвращает последнюю на прежнее место.
const removedImportRows = [];

async function removeImportRow(row) {
  const confirmed = await confirmAction({
    title: 'Удалить строку?',
    message: `Артикул ${row.sku}${row.article ? ` — ${row.article.name}` : ''}, ${row.source}. Строка не попадёт в заявку.`,
    confirmLabel: 'Удалить'
  });
  if (!confirmed) {
    $('#import-rows').querySelectorAll('.line-remove')[state.importRows.indexOf(row)]?.focus();
    return;
  }
  const index = state.importRows.indexOf(row);
  state.importRows.splice(index, 1);
  removedImportRows.push({ row, index });
  markDuplicates();
  renderImport();
  // Фокус — на корзину строки, вставшей на место удалённой, иначе на «Вернуть».
  const next = $('#import-rows').querySelectorAll('.line-remove')[index] ?? $('#import-undo-button');
  next.focus();
}

export function restoreImportRow() {
  const last = removedImportRows.pop();
  if (!last) return;
  state.importRows.splice(Math.min(last.index, state.importRows.length), 0, last.row);
  markDuplicates();
  renderImport();
  if (!removedImportRows.length) $('#import-rows').querySelectorAll('.line-remove')[last.index]?.focus();
}

function renderImportUndo() {
  const last = removedImportRows.at(-1);
  $('#import-undo').hidden = !last;
  if (!last) return;
  const more = removedImportRows.length - 1;
  $('#import-undo-text').textContent = `Строка с артикулом ${last.row.sku} удалена${more ? ` (всего удалено: ${removedImportRows.length})` : ''}.`;
}

export function evaluateImportRow(row) {
  if (!row.article) return { kind: 'missing', canAdd: false, message: 'Проверьте артикул или попросите менеджера добавить его в каталог.' };
  if (row.duplicateOf) return { kind: 'duplicate', canAdd: false, message: `Этот артикул уже есть выше (${row.duplicateOf.source}).` };
  if (inOrder(row.article)) return { kind: 'inOrder', canAdd: false, message: 'Тираж можно изменить в заявке.' };
  const category = categories().get(row.article.categoryId);
  const result = quote(row.quantity, category, row.quantity < category.minimumQuantity ? 'standard' : row.urgency);
  // В таблице на десятки строк — короткие пояснения вместо подсказок калькулятора.
  const message = {
    good: '',
    reduced: `От ${integer.format(minimumValid(category))} шт. — ${money.format(category.prices.standard)} за штуку.`,
    multiple: `Кратность ${integer.format(category.multiple)} шт.`,
    blocked: `Минимальный заказ — ${integer.format(result.suggested)} шт.`
  }[result.status];
  return { ...result, message, kind: result.status, urgencyDropped: result.canAdd && result.urgency !== row.urgency };
}

// «Исправить» — то, без чего позицию не принять или тираж не по кратности.
// Сниженный тираж допустим, поэтому переход на минимальный — только по кнопке в строке.
export function fixable(result) {
  return Boolean(result.suggested) && (result.kind === 'multiple' || result.kind === 'blocked');
}

export function applyImportSuggestion(row, value) {
  row.quantity = value;
  renderImport();
}

export function renderImport() {
  const body = $('#import-rows');
  body.innerHTML = '';
  const counts = {};
  let addable = 0;
  let total = 0;
  state.importRows.forEach(row => {
    const result = evaluateImportRow(row);
    counts[result.kind] = (counts[result.kind] ?? 0) + 1;
    if (result.canAdd) {
      addable += 1;
      total += roundMoney(row.quantity * result.unitPrice);
    }
    const tr = document.createElement('tr');
    tr.dataset.kind = result.kind;

    const company = state.data.companies.find(item => item.id === row.companyId);
    const code = cell('td', row.sku, 'code');
    code.prepend(cell('small', company?.name ?? '—'));
    code.append(cell('small', row.source));

    const quantity = document.createElement('td');
    quantity.className = 'num';
    quantity.dataset.cell = 'quantity';
    const input = document.createElement('input');
    input.inputMode = 'numeric';
    input.value = integer.format(row.quantity);
    input.ariaLabel = `Тираж артикула ${row.sku}`;
    input.disabled = !row.article || Boolean(row.duplicateOf);
    input.addEventListener('change', () => applyImportSuggestion(row, quantityValue(input.value)));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
    quantity.append(input);

    const status = document.createElement('td');
    status.dataset.cell = 'status';
    const box = document.createElement('div');
    box.className = 'import-status';
    box.append(cell('em', importLabels[result.kind]));
    if (result.kind !== 'good') box.append(cell('span', result.message));
    if (result.urgencyDropped) box.append(cell('span', `${urgencyLabels[row.urgency]} заказ — только от минимального тиража. Посчитано как стандартный.`));
    if (row.note) box.append(cell('span', row.note));
    if (result.suggested && result.canAdd !== undefined && (fixable(result) || result.kind === 'reduced')) {
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.textContent = result.kind === 'reduced'
        ? `Взять ${integer.format(result.suggested)} — по ${money.format(categories().get(row.article.categoryId).prices.standard)}`
        : `Применить ${integer.format(result.suggested)}`;
      apply.addEventListener('click', () => applyImportSuggestion(row, result.suggested));
      box.append(apply);
    }
    status.append(box);

    const price = cell('td', result.canAdd ? money.format(result.unitPrice) : '—', 'price');
    price.className = 'num';
    const sum = cell('td', result.canAdd ? money.format(roundMoney(row.quantity * result.unitPrice)) : '—', 'sum');
    sum.className = 'num';
    const removeCell = document.createElement('td');
    removeCell.dataset.cell = 'remove';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'line-remove';
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    remove.title = 'Удалить строку';
    remove.ariaLabel = `Удалить строку с артикулом ${row.sku}`;
    remove.addEventListener('click', () => removeImportRow(row));
    removeCell.append(remove);

    tr.append(removeCell, code, cell('td', row.article?.name ?? '—', 'name'), quantity, status, price, sum);
    body.append(tr);
  });
  renderImportUndo();

  const parts = ['good', 'reduced', 'multiple', 'blocked', 'missing', 'duplicate', 'inOrder']
    .filter(kind => counts[kind])
    .map(kind => `${importLabels[kind].toLocaleLowerCase('ru-RU')} — ${counts[kind]}`);
  $('#import-summary').textContent = state.importRows.length
    ? `${state.importRows.length} ${plural(state.importRows.length, 'строка', 'строки', 'строк')}: ${parts.join(', ')}.`
    : 'Все строки удалены.';
  const fixes = state.importRows.filter(row => fixable(evaluateImportRow(row))).length;
  $('#import-fix-all').disabled = !fixes;
  $('#import-fix-all').textContent = fixes ? `Исправить тиражи (${fixes})` : 'Исправлять нечего';
  const skipped = state.importRows.length - addable;
  $('#import-skipped').textContent = !state.importRows.length
    ? ''
    : skipped
    ?`${skipped} ${plural(skipped, 'строка не войдёт', 'строки не войдут', 'строк не войдут')} в заявку, причина указана в столбце «Проверка».`
    : 'Все строки можно добавить.';
  const add = $('#import-add');
  add.disabled = !addable;
  add.textContent = addable
    ? `Добавить ${addable} ${plural(addable, 'позицию', 'позиции', 'позиций')} · ${money.format(roundMoney(total))}`
    : 'Нечего добавить';
}

export async function importFile(file) {
  if (!file) return;
  if (!state.data.articles.length) {
    toast('Каталог ещё загружается. Выберите файл через минуту.', { persist: true });
    return;
  }
  if (!/\.xlsx$/i.test(file.name)) {
    toast('Нужен файл Excel в формате .xlsx.', { persist: true });
    return;
  }
  toast('Читаем файл…');
  try {
    const items = await readImportFile(file);
    if (!items.length) {
      toast('В файле не нашлось строк с артикулом и тиражом. Нужны столбцы «Код» или «Артикул» и «Тираж» или «Количество».', { persist: true });
      return;
    }
    prepareImport(items);
    renderImport();
    markImportedFile(file.name, items.length);
    $('#import-dialog').showModal();
  } catch (error) {
    toast(error.message, { persist: true });
  }
}

// После загрузки зона показывает галочку, имя файла и число строк; кнопка — «Выбрать другой файл».
export function markImportedFile(name, count) {
  const zone = $('#import-drop');
  zone.dataset.state = 'loaded';
  const textNode = $('#import-drop-text');
  textNode.innerHTML = '';
  textNode.append(cell('strong', 'Файл загружен:'), ` ${name} · ${count} ${plural(count, 'строка', 'строки', 'строк')}`);
  $('#import-file-button').textContent = 'Выбрать другой файл';
}

export function addImportedLines() {
  let added = 0;
  state.importRows.forEach(row => {
    const result = evaluateImportRow(row);
    if (!result.canAdd) return;
    state.order.push(makeLine(row.article, row.quantity, result));
    added += 1;
  });
  const skipped = state.importRows.length - added;
  $('#import-dialog').close();
  clearOrderFilters();
  state.orderPage = 1;
  renderOrder();
  toast(`Добавлено ${added} ${plural(added, 'позиция', 'позиции', 'позиций')}${skipped ? `, пропущено ${skipped}` : ''}.`);
}
