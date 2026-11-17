// Вкладка «Категории» у администратора: категории листа «Категории» — цены, тиражи, кратность.
// Сайт меняет только то, что на листе вводится руками, и H/O (кратность, сниженный тираж «от»).
// Срочная цена, «до» и цена сниженного тиража остаются формулами таблицы: здесь они только показаны.
import { $, money } from './format.js';
import { adminErrorText, isAdmin, postAction, TRASH_ICON } from './admin.js';
import { confirmAction } from './confirm.js';
import { toast } from './toast.js';

export const categoryRowsRequest = () => postAction('categoryRows', {}, 30000);
export const saveCategoryRequest = fields => postAction('saveCategory', fields, 30000);
export const deleteCategoryRequest = fields => postAction('deleteCategory', fields, 30000);

// Коэффициенты формул листа: L = D × 1,5, R = D × 1,35, Q = E − 1.
export const URGENT_RATE = 1.5;
export const REDUCED_RATE = 1.35;

// Число из поля формы: «1,13» → 1.13, «8 000» → 8000. Пусто или не число — null.
export function formNumber(value) {
  const raw = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return number > 0 ? number : null;
}

// Что посчитает таблица по полям формы: срочная цена, кратность, сниженный тираж «от»–«до» и его цена.
export function categoryPreview(form) {
  const price = formNumber(form.price);
  const minimum = formNumber(form.minimum);
  const roll = formNumber(form.roll);
  const lanes = formNumber(form.lanes);
  return {
    // Что дали бы формулы таблицы, если поле оставить пустым.
    multipleByFormula: roll !== null && lanes !== null ? roll * lanes : null,
    reducedFromByFormula: roll,
    urgent: price === null ? null : price * URGENT_RATE,
    reducedPrice: price === null ? null : price * REDUCED_RATE,
    multiple: formNumber(form.multiple) ?? (roll !== null && lanes !== null ? roll * lanes : null),
    reducedFrom: formNumber(form.reducedFrom) ?? roll,
    reducedTo: minimum === null ? null : minimum - 1
  };
}

// Изменения цен при правке: [«Стоимость: 1,13 ₽ → 1,20 ₽», …]. Пусто — цены те же.
export function priceChanges(category, form) {
  const changes = [];
  const before = { price: Number(category.price), emergency: Number(category.emergency) };
  const after = { price: formNumber(form.price), emergency: formNumber(form.emergency) };
  const label = { price: 'Стоимость', emergency: 'Экстренный заказ' };
  ['price', 'emergency'].forEach(key => {
    if (after[key] !== null && Math.abs(after[key] - before[key]) > 1e-9) {
      changes.push(`${label[key]}: ${money.format(before[key])} → ${money.format(after[key])}`);
    }
  });
  if (after.price !== null && Math.abs(after.price - before.price) > 1e-9) {
    changes.push(`Срочный заказ: ${money.format(before.price * URGENT_RATE)} → ${money.format(after.price * URGENT_RATE)}`);
    changes.push(`Сниженный тираж: ${money.format(before.price * REDUCED_RATE)} → ${money.format(after.price * REDUCED_RATE)}`);
  }
  return changes;
}

// Значения формы для правки: пустая кратность и «от» — значит, в таблице формула.
export function categoryFormValues(category) {
  const value = item => (item === null || item === undefined ? '' : String(item).replace('.', ','));
  return {
    size: category.size,
    color: category.color,
    price: value(category.price),
    emergency: value(category.emergency),
    minimum: value(category.minimum),
    roll: value(category.roll),
    lanes: value(category.lanes),
    multiple: category.multipleFormula ? '' : value(category.multiple),
    reducedFrom: category.reducedFromFormula ? '' : value(category.reducedFrom)
  };
}

const view = { list: [], nextId: 1, loaded: false, loading: null, error: '' };
let editing = null;
let refreshCatalog = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null && text !== '') element.textContent = text;
  return element;
}

const integer = new Intl.NumberFormat('ru-RU');
const count = value => (value === null || value === undefined || value === '' ? '—' : integer.format(Number(value)));
const price = value => (value === null || value === undefined || value === '' ? '—' : money.format(Number(value)));

export async function loadCategories({ force = false } = {}) {
  if (!isAdmin() || location.hash !== '#categories') return;
  if (view.loading) return view.loading;
  if (view.loaded && !force) {
    renderCategories();
    return;
  }
  view.error = '';
  view.loading = (async () => {
    await Promise.resolve();
    try {
      const payload = await categoryRowsRequest();
      view.list = Array.isArray(payload.categories) ? payload.categories : [];
      view.nextId = Number(payload.nextId) || 1;
      view.loaded = true;
    } catch (error) {
      console.warn('Категории не загружены:', error);
      view.error = adminErrorText(error, 'Категории не загрузились');
    } finally {
      view.loading = null;
      renderCategories();
    }
  })();
  renderCategories();
  return view.loading;
}

export function renderCategories() {
  const body = $('#category-rows');
  if (!body) return;
  $('#categories-view').ariaBusy = String(Boolean(view.loading));
  $('#categories-error').hidden = !view.error;
  $('#categories-error').textContent = view.error;
  $('#categories-loading').hidden = !view.loading || view.loaded;
  $('#categories-table').hidden = !view.loaded;
  if (!view.loaded) return;
  body.replaceChildren(...view.list.map(categoryRow));
}

function cellWith(label, ...content) {
  const td = node('td');
  td.dataset.label = label;
  td.append(...content);
  return td;
}

function categoryRow(category) {
  const row = node('tr');
  const id = node('th', 'category-id', category.id);
  id.scope = 'row';
  const name = node('div', 'category-name');
  name.append(node('strong', '', category.size), node('span', '', category.color));
  const reduced = category.reducedFrom === null
    ? node('span', 'category-muted', 'нет')
    : node('span', '', `${count(category.reducedFrom)}–${count(category.reducedTo)} шт. · ${price(category.reducedPrice)}`);
  const multiple = node('span', '', count(category.multiple));
  if (category.multipleFormula) multiple.title = 'Считается в таблице: в роле × ручьёв';

  const actions = node('div', 'category-actions');
  const editButton = node('button', 'text-button', 'Изменить');
  editButton.type = 'button';
  editButton.setAttribute('aria-label', `Изменить категорию ${category.id}`);
  editButton.addEventListener('click', () => openCategoryForm(category));
  const remove = node('button', 'article-delete');
  remove.type = 'button';
  remove.title = 'Удалить категорию';
  remove.setAttribute('aria-label', `Удалить категорию ${category.id}`);
  remove.innerHTML = TRASH_ICON;
  remove.addEventListener('click', () => deleteCategoryWithConfirm(category, remove));
  actions.append(editButton, remove);

  row.append(
    id,
    cellWith('Этикетка', name),
    cellWith('Стоимость', node('span', 'category-price', price(category.price))),
    cellWith('Срочно', node('span', '', price(category.urgent))),
    cellWith('Экстренно', node('span', '', price(category.emergency))),
    cellWith('Мин. тираж', node('span', '', count(category.minimum))),
    cellWith('Кратность', multiple),
    cellWith('Сниженный тираж', reduced),
    cellWith('Артикулов', node('span', '', String(category.articles))),
    cellWith('', actions)
  );
  return row;
}

// ───── Форма ─────

function formFields() {
  return Object.fromEntries(new FormData($('#category-form')).entries());
}

function renderPreview() {
  const preview = categoryPreview(formFields());
  $('#category-urgent').textContent = price(preview.urgent);
  $('#category-multiple-hint').textContent = preview.multipleByFormula === null ? 'Пусто — в роле × ручьёв' : `Пусто — в роле × ручьёв = ${count(preview.multipleByFormula)}`;
  $('#category-from-hint').textContent = preview.reducedFromByFormula === null ? 'Пусто — как «в роле»' : `Пусто — как «в роле» = ${count(preview.reducedFromByFormula)}`;
  $('#category-reduced').textContent = preview.reducedFrom === null || preview.reducedTo === null
    ? '—'
    : `${count(preview.reducedFrom)}–${count(preview.reducedTo)} шт. · ${price(preview.reducedPrice)}`;
}

export function openCategoryForm(category = null) {
  editing = category;
  const form = $('#category-form');
  form.reset();
  $('#category-form-title').textContent = category ? `Категория ${category.id}` : `Новая категория ${view.nextId}`;
  $('#category-form-error').hidden = true;
  const values = category ? categoryFormValues(category) : {};
  Object.entries(values).forEach(([key, value]) => { form.elements[key].value = value; });
  renderPreview();
  setBusy(false);
  $('#category-dialog').showModal();
  form.elements.size.focus();
}

function setBusy(busy) {
  $('#category-submit').disabled = busy;
  $('#category-submit').ariaBusy = String(busy);
  $('#category-submit-label').textContent = busy ? 'Сохраняем…' : 'Сохранить';
}

async function submitCategoryForm(event) {
  event.preventDefault();
  const fields = formFields();
  if (editing) {
    const changes = priceChanges(editing, fields);
    if (changes.length) {
      const confirmed = await confirmAction({
        title: `Поменять цены категории ${editing.id}?`,
        message: `${changes.join('. ')}. Новые цены сразу увидят все клиенты. Отправленные заявки не изменятся.`,
        confirmLabel: 'Поменять цены'
      });
      if (!confirmed) return;
    }
  }
  const error = $('#category-form-error');
  error.hidden = true;
  setBusy(true);
  try {
    const payload = { category: fields };
    if (editing) Object.assign(payload, { row: editing.row, id: editing.id });
    const reply = await saveCategoryRequest(payload);
    $('#category-dialog').close();
    toast(editing ? `Категория ${reply.id} сохранена.` : `Категория ${reply.id} добавлена в таблицу, строка ${reply.row}.`);
    await loadCategories({ force: true });
    refreshCatalog?.();
  } catch (failure) {
    error.textContent = adminErrorText(failure, 'Категория не сохранена');
    error.hidden = false;
  } finally {
    setBusy(false);
  }
}

async function deleteCategoryWithConfirm(category, button) {
  if (category.articles > 0) {
    toast(`В категории ${category.id} ${category.articles} арт. Сначала перенесите их в другую категорию на вкладке «Артикулы».`, { persist: true });
    return;
  }
  const confirmed = await confirmAction({
    title: `Удалить категорию ${category.id}?`,
    message: `Строка ${category.row} исчезнет с листа «Категории», строки ниже сдвинутся вверх. Отменить нельзя.`,
    confirmLabel: 'Удалить'
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    await deleteCategoryRequest({ row: category.row, id: category.id });
    toast(`Категория ${category.id} удалена.`);
    await loadCategories({ force: true });
    refreshCatalog?.();
  } catch (failure) {
    button.disabled = false;
    toast(adminErrorText(failure, 'Категория не удалена'), { persist: true });
  }
}

export function initCategories({ onCatalogChange } = {}) {
  refreshCatalog = onCatalogChange;
  $('#add-category').addEventListener('click', () => openCategoryForm());
  $('#category-form').addEventListener('submit', submitCategoryForm);
  $('#category-form').addEventListener('input', renderPreview);
  $('#category-cancel').addEventListener('click', () => $('#category-dialog').close());
  $('#close-category-dialog').addEventListener('click', () => $('#category-dialog').close());
  $('#category-dialog').addEventListener('cancel', event => {
    if ($('#category-submit').disabled) event.preventDefault();
  });
}

export function forgetCategories() {
  view.list = [];
  view.loaded = false;
  view.error = '';
  if ($('#category-dialog')?.open) $('#category-dialog').close();
}
