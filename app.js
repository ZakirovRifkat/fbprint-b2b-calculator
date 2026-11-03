const demoCatalog = {
  schemaVersion: 1,
  version: 'demo-2026-11-03',
  companies: [
    { id: 'global_food', name: 'Глобал Фуд' },
    { id: 'studio_vkusa', name: 'Студия Вкуса' }
  ],
  categories: [
    {
      id: '27',
      size: '80 × 120 мм',
      color: 'Текст с фоном',
      minimumQuantity: 4200,
      rollQuantity: 1400,
      lanes: 3,
      multiple: 4200,
      prices: { standard: 1.2, urgent: 1.8, emergency: 2.4 },
      reducedRun: { minQuantity: 1400, maxQuantity: 4199, price: 1.62 }
    },
    {
      id: '6',
      size: '60 × 100 мм',
      color: 'Ч/Б',
      minimumQuantity: 5600,
      rollQuantity: 1400,
      lanes: 4,
      multiple: 5600,
      prices: { standard: 0.75, urgent: 1.125, emergency: 1.5 },
      reducedRun: { minQuantity: 1400, maxQuantity: 5599, price: 1.0125 }
    },
    {
      id: '38',
      size: 'D80',
      color: 'Цветная',
      minimumQuantity: 7200,
      rollQuantity: 1800,
      lanes: 2,
      multiple: 3600,
      prices: { standard: 1.09, urgent: 1.635, emergency: 2.18 },
      reducedRun: { minQuantity: 1800, maxQuantity: 7199, price: 1.4715 }
    },
    {
      id: '18',
      size: '60 × 70 мм',
      color: 'Текст с фоном',
      minimumQuantity: 5400,
      rollQuantity: 1800,
      lanes: 3,
      multiple: 5400,
      prices: { standard: 1.03, urgent: 1.545, emergency: 2.06 },
      reducedRun: { minQuantity: 1800, maxQuantity: 5399, price: 1.3905 }
    }
  ],
  articles: [
    { companyId: 'global_food', sku: '10165', categoryId: '27', name: 'Этикетка «Грудка куриная с картофелем»' },
    { companyId: 'global_food', sku: '10167', categoryId: '6', name: 'Этикетка «Борщ украинский с курицей»' },
    { companyId: 'global_food', sku: '10338', categoryId: '38', name: 'Этикетка «Борщ Украинский»' },
    { companyId: 'global_food', sku: '10351', categoryId: '18', name: 'Этикетка «Борщ вегетарианский»' },
    { companyId: 'studio_vkusa', sku: '20110', categoryId: '27', name: 'Этикетка «Салат Оливье»' },
    { companyId: 'studio_vkusa', sku: '20118', categoryId: '18', name: 'Этикетка «Суп-крем куриный»' }
  ]
};

const $ = selector => document.querySelector(selector);
const money = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 4
});
const integer = new Intl.NumberFormat('ru-RU');
const searchLimit = 6;
const urgencyLabels = {
  standard: 'Стандартный',
  urgent: 'Срочный',
  emergency: 'Экстренный'
};
const conditionLabels = {
  good: 'Оптимальные условия',
  warning: 'Требуется корректировка кратности',
  danger: 'Ниже минимального тиража'
};

const emptyCatalog = { schemaVersion: 1, version: '', companies: [], categories: [], articles: [] };

let data = apiUrl() ? emptyCatalog : normalizeCatalog(demoCatalog);
let companyId = data.companies[0]?.id ?? '';
let article = null;
let order = [];
let loadController = null;
let loadedAt = null;

function apiUrl() {
  return String(window.FBPRINT_CONFIG?.apiUrl ?? '').trim();
}

// path — где ошибка, словами из таблицы: «Категория 7: «Стоимость»».
function text(value, path) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${path} — не заполнено`);
  return result;
}

function number(value, path, { integerOnly = false, optional = false } = {}) {
  if ((value === null || value === undefined || value === '') && optional) return null;

  let normalized = value;
  if (typeof value === 'string') {
    normalized = value.trim().replace(/\s/g, '').replace(/[^\d,.-]/g, '');
    const comma = normalized.lastIndexOf(',');
    const dot = normalized.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      normalized = comma > dot
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(/,/g, '');
    } else {
      normalized = normalized.replace(',', '.');
    }
  }

  const result = Number(normalized);
  if (!Number.isFinite(result) || result <= 0 || (integerOnly && !Number.isInteger(result))) {
    throw new Error(`${path} — нужно ${integerOnly ? 'целое ' : ''}число больше нуля`);
  }
  return result;
}

// Формулы таблицы дают доли копейки (0,75 × 1,5 = 1,125), а таблица показывает 1,13 ₽.
// toFixed убирает хвосты двоичной арифметики: 1,425 × 100 = 142,49999999999997.
function roundMoney(value) {
  return Math.round(Number((value * 100).toFixed(6))) / 100;
}

function price(value, path) {
  const result = roundMoney(number(value, path));
  if (result <= 0) throw new Error(`${path} — нужно число больше нуля`);
  return result;
}

function ensureUnique(items, key, describe) {
  const seen = new Set();
  items.forEach(item => {
    const value = key(item);
    if (seen.has(value)) throw new Error(`${describe(item)} встречается дважды`);
    seen.add(value);
  });
}

function normalizeCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('API вернул каталог в неверном формате');
  }
  if (raw.error) {
    throw new Error(String(raw.error.message ?? raw.error));
  }
  if (!Array.isArray(raw.companies) || !Array.isArray(raw.categories) || !Array.isArray(raw.articles)) {
    throw new Error('В ответе API нужны массивы companies, categories и articles');
  }

  const schemaVersion = Number(raw.schemaVersion ?? 1);
  if (schemaVersion !== 1) {
    throw new Error(`Версия API ${schemaVersion} не поддерживается`);
  }

  const companies = raw.companies.map((company, index) => ({
    id: text(company?.id, `Компания №${index + 1}: id`),
    name: text(company?.name, `Компания №${index + 1}: название`)
  }));
  const companyNames = new Map(companies.map(company => [company.id, company.name]));

  const categories = raw.categories.map((category, index) => {
    const where = `Лист «Категории», категория ${String(category?.id ?? '').trim() || `в строке ${index + 2}`}`;
    const prices = category?.prices ?? {};
    const reducedRun = category?.reducedRun;
    return {
      id: text(category?.id, `${where}: «Категория»`),
      size: text(category?.size, `${where}: «Размер этикетки»`),
      color: text(category?.color, `${where}: «Цветность»`),
      minimumQuantity: number(category?.minimumQuantity, `${where}: «Минимальный тираж»`, { integerOnly: true }),
      rollQuantity: number(category?.rollQuantity, `${where}: «Кол-во в роле»`, { integerOnly: true, optional: true }),
      lanes: number(category?.lanes, `${where}: «Кол-во ручьев»`, { integerOnly: true, optional: true }),
      multiple: number(category?.multiple, `${where}: «Кратность»`, { integerOnly: true }),
      prices: {
        standard: price(prices.standard, `${where}: «Стоимость»`),
        urgent: price(prices.urgent, `${where}: «Срочный заказ»`),
        emergency: price(prices.emergency, `${where}: «Экстренный заказ»`)
      },
      reducedRun: reducedRun ? normalizeReducedRun(reducedRun, where) : null
    };
  });

  const articles = raw.articles.map(item => {
    const sku = String(item?.sku ?? '').trim();
    const name = String(item?.name ?? '').trim();
    const company = companyNames.get(String(item?.companyId ?? '').trim()) ?? item?.companyId;
    const shortName = name.length > 40 ? `${name.slice(0, 40).trim()}…` : name;
    const where = `Артикул ${sku || `«${shortName}»`} (${company})`;
    return {
      companyId: text(item?.companyId, `${where}: компания`),
      sku: text(item?.sku, `${where}: «Арт.»`),
      categoryId: text(item?.categoryId, `${where}: «Категория»`),
      name: text(item?.name, `${where}: «Наименование»`)
    };
  });

  if (!companies.length || !categories.length) throw new Error('API вернул пустой каталог');
  ensureUnique(companies, item => item.id, item => `Компания ${item.id}`);
  ensureUnique(categories, item => item.id, item => `Лист «Категории»: категория ${item.id}`);
  ensureUnique(articles, item => `${item.companyId}/${item.sku}`, item => `Артикул ${item.sku} (${companyNames.get(item.companyId)})`);

  const categoryIds = new Set(categories.map(item => item.id));
  articles.forEach(item => {
    if (!companyNames.has(item.companyId)) {
      throw new Error(`Артикул ${item.sku}: неизвестная компания ${item.companyId}`);
    }
    if (!categoryIds.has(item.categoryId)) {
      throw new Error(`Артикул ${item.sku} (${companyNames.get(item.companyId)}): категории ${item.categoryId} нет на листе «Категории»`);
    }
  });

  return {
    schemaVersion,
    version: String(raw.version ?? raw.generatedAt ?? ''),
    companies,
    categories,
    articles
  };
}

function normalizeReducedRun(reducedRun, where) {
  const result = {
    minQuantity: number(reducedRun.minQuantity, `${where}: «Сниженное кол-во тиража» от`, { integerOnly: true }),
    maxQuantity: number(reducedRun.maxQuantity, `${where}: «Сниженное кол-во тиража» до`, { integerOnly: true }),
    price: price(reducedRun.price, `${where}: «Стоимость сниженного тиража»`)
  };
  if (result.minQuantity > result.maxQuantity) {
    throw new Error(`${where}: в «Сниженное кол-во тиража» значение «от» больше, чем «до»`);
  }
  return result;
}

const categories = () => new Map(data.categories.map(item => [item.id, item]));

function setDataStatus(state, message) {
  const meta = $('.header-meta');
  meta.dataset.state = state;
  meta.ariaBusy = String(state === 'loading');
  $('#data-status').textContent = message;
  $('#refresh-data').disabled = state === 'loading';
}

function applyCatalog(nextData) {
  const selectedKey = article ? `${article.companyId}/${article.sku}` : null;
  data = nextData;

  if (!data.companies.some(company => company.id === companyId)) {
    companyId = data.companies[0]?.id ?? '';
  }
  article = selectedKey
    ? data.articles.find(item => `${item.companyId}/${item.sku}` === selectedKey) ?? null
    : null;

  $('#article-search').disabled = !data.companies.length;
  renderCompanies();
  renderSelected({ resetQuantity: false });
  renderSearch($('#article-search').value);
  renderOrder();
}

function showCatalogError(title, message) {
  $('#catalog-alert-title').textContent = title;
  $('#catalog-alert-message').textContent = message;
  $('#catalog-alert').hidden = !title;
}

async function loadData() {
  const url = apiUrl();
  if (!url) {
    applyCatalog(normalizeCatalog(demoCatalog));
    setDataStatus('demo', 'Демо-данные');
    return;
  }

  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const timeoutMs = Number(window.FBPRINT_CONFIG?.requestTimeoutMs) || 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  setDataStatus('loading', 'Обновляем данные…');

  try {
    const endpoint = new URL(url, window.location.href);
    endpoint.searchParams.set('action', 'catalog');
    endpoint.searchParams.set('ts', Date.now());
    const response = await fetch(endpoint, {
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`API ответил с кодом ${response.status}`);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('API вернул не JSON');
    }

    applyCatalog(normalizeCatalog(payload));
    loadedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    setDataStatus('live', `Данные актуальны · ${loadedAt}`);
    showCatalogError('');
  } catch (error) {
    // Запрос отменён более новым нажатием «Обновить» — ошибки нет.
    if (controller !== loadController) return;
    const message = error.name === 'AbortError'
      ? 'API не ответил вовремя'
      : error.message;
    if (loadedAt) {
      setDataStatus('error', `Не удалось обновить · данные от ${loadedAt}`);
      showCatalogError('Не удалось обновить каталог', `${message}. Расчёт идёт по данным, загруженным в ${loadedAt}.`);
    } else {
      applyCatalog(emptyCatalog);
      setDataStatus('error', 'Каталог недоступен');
      showCatalogError('Не удалось загрузить каталог', `${message}. Расчёт недоступен. Нажмите «Обновить» или сообщите менеджеру FB Print.`);
    }
    toast('Ошибка загрузки каталога.');
  } finally {
    clearTimeout(timeout);
  }
}

function selectCompany(nextCompanyId) {
  companyId = nextCompanyId;
  article = null;
  $('#article-search').value = '';
  renderCompanies();
  renderSelected();
  renderSearch('');
  $('#article-search').focus();
}

function renderCompanies() {
  const root = $('#company-switch');
  root.innerHTML = '';
  data.companies.forEach(company => {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'radio';
    button.ariaChecked = String(company.id === companyId);
    button.textContent = company.name;
    button.addEventListener('click', () => selectCompany(company.id));
    root.append(button);
  });
}

// В названиях встречаются и «Ё», и «Е»: «КОПЧЁНОСТЯМИ» и «КОПЧЕНОСТЯМИ».
function searchKey(value) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function matchingArticles(query = '') {
  const normalized = searchKey(query.trim());
  return data.articles.filter(item => {
    if (item.companyId !== companyId) return false;
    if (!normalized) return true;
    return searchKey(item.sku).includes(normalized) || searchKey(item.name).includes(normalized);
  });
}

function hideSearch() {
  $('#search-results').hidden = true;
  $('#article-search').ariaExpanded = 'false';
}

function renderSearch(query) {
  const root = $('#search-results');
  if (!query.trim()) {
    root.innerHTML = '';
    hideSearch();
    return;
  }

  const categoryMap = categories();
  const matches = matchingArticles(query);
  const items = matches.slice(0, searchLimit);
  root.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.role = 'status';
    empty.textContent = 'Ничего не найдено. Проверьте номер или название.';
    root.append(empty);
  }

  items.forEach(item => {
    const category = categoryMap.get(item.categoryId);
    const button = document.createElement('button');
    const sku = document.createElement('strong');
    const name = document.createElement('span');
    const size = document.createElement('small');
    button.type = 'button';
    button.className = 'result-button';
    button.role = 'option';
    sku.textContent = item.sku;
    name.textContent = item.name;
    size.textContent = category?.size ?? '';
    button.append(sku, name, size);
    button.addEventListener('click', () => selectArticle(item));
    root.append(button);
  });

  if (matches.length > items.length) {
    const more = document.createElement('div');
    more.className = 'search-more';
    more.textContent = `Показаны ${items.length} из ${matches.length}. Уточните номер или название.`;
    root.append(more);
  }

  root.hidden = false;
  $('#article-search').ariaExpanded = 'true';
}

function selectArticle(nextArticle) {
  article = nextArticle;
  $('#article-search').value = '';
  hideSearch();
  renderSelected();
  $('#quantity').focus();
}

function setCalculationDisabled(disabled) {
  $('#calculation-block').ariaDisabled = String(disabled);
  $('.urgency').disabled = disabled;
  $('#quantity').disabled = disabled;
  $('#quantity-minus').disabled = disabled;
  $('#quantity-plus').disabled = disabled;
}

function renderSelected({ resetQuantity = true } = {}) {
  const product = $('#selected-product');
  if (!article) {
    product.hidden = true;
    setCalculationDisabled(true);
    $('#add-line').disabled = true;
    renderCalculation();
    return;
  }

  const category = categories().get(article.categoryId);
  const company = data.companies.find(item => item.id === article.companyId);
  product.hidden = false;
  $('#product-company').textContent = company.name;
  $('#product-sku').textContent = article.sku;
  $('#product-name').textContent = article.name;
  $('#product-size').textContent = category.size;
  $('#product-color').textContent = category.color;
  setCalculationDisabled(false);
  if (resetQuantity) $('#quantity').value = category.minimumQuantity;
  renderCalculation();
}

function quantity() {
  return Math.max(0, Number(String($('#quantity').value).replace(/\D/g, '')) || 0);
}

function validateQuantity(value, category) {
  if (value < category.minimumQuantity) {
    return {
      state: 'danger',
      title: 'Тираж ниже минимального',
      message: `Для оптимальных условий необходимо увеличить количество до ${integer.format(category.minimumQuantity)} шт.`,
      suggested: category.minimumQuantity
    };
  }
  if (value % category.multiple !== 0) {
    const next = Math.ceil(value / category.multiple) * category.multiple;
    return {
      state: 'warning',
      title: 'Тираж не соответствует кратности',
      message: `Для оптимальных условий необходимо привести количество к кратному ${integer.format(category.multiple)}. Ближайшее допустимое значение — ${integer.format(next)} шт.`,
      suggested: next
    };
  }
  return {
    state: 'good',
    title: 'Соответствует оптимальным условиям',
    message: `Тираж не ниже минимума и кратен ${integer.format(category.multiple)}.`,
    suggested: null
  };
}

function selectedUrgency() {
  return document.querySelector('[name=urgency]:checked')?.value ?? 'standard';
}

function renderCalculation() {
  const condition = $('#condition');
  const apply = $('#apply-suggestion');
  if (!article) {
    condition.dataset.state = 'idle';
    $('#condition-title').textContent = 'Выберите артикул';
    $('#condition-message').textContent = 'После выбора появятся условия тиража.';
    apply.hidden = true;
    $('#line-total').textContent = '—';
    $('#line-quantity').textContent = '0 шт.';
    $('#unit-price').textContent = '—';
    $('#minimum-value').textContent = '—';
    $('#multiple-value').textContent = '—';
    $('#add-line').disabled = true;
    return;
  }

  const category = categories().get(article.categoryId);
  const value = quantity();
  const price = category.prices[selectedUrgency()];
  const result = validateQuantity(value, category);
  condition.dataset.state = result.state;
  $('#condition-title').textContent = result.title;
  $('#condition-message').textContent = result.message;
  apply.hidden = !result.suggested;
  if (result.suggested) {
    apply.textContent = `Применить ${integer.format(result.suggested)}`;
    apply.onclick = () => {
      $('#quantity').value = result.suggested;
      renderCalculation();
    };
  }
  $('#line-total').textContent = money.format(roundMoney(value * price));
  $('#line-quantity').textContent = `${integer.format(value)} шт.`;
  $('#unit-price').textContent = money.format(price);
  $('#minimum-value').textContent = integer.format(category.minimumQuantity);
  $('#multiple-value').textContent = integer.format(category.multiple);
  $('#add-line').disabled = value <= 0;
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addLine() {
  if (!article) return;
  const category = categories().get(article.categoryId);
  const value = quantity();
  if (value <= 0) {
    toast('Укажите количество больше нуля.');
    return;
  }

  const urgency = selectedUrgency();
  const price = category.prices[urgency];
  const company = data.companies.find(item => item.id === article.companyId);
  const result = validateQuantity(value, category);
  order.push({
    id: createId(),
    company: company.name,
    sku: article.sku,
    name: article.name,
    quantity: value,
    urgency,
    unitPrice: price,
    total: roundMoney(value * price),
    status: result.state
  });
  renderOrder();
  toast(result.state === 'good'
    ? 'Позиция добавлена в заявку.'
    : 'Позиция добавлена. Проверьте условия тиража.');
}

function renderOrder() {
  const empty = $('#order-empty');
  const root = $('#order-lines');
  empty.hidden = order.length > 0;
  root.innerHTML = '';

  order.forEach(line => {
    const item = document.createElement('div');
    const title = document.createElement('strong');
    const details = document.createElement('span');
    const total = document.createElement('b');
    const remove = document.createElement('button');
    item.className = 'order-line';
    title.textContent = `${line.sku} · ${line.name}`;
    details.textContent = `${integer.format(line.quantity)} шт. · ${urgencyLabels[line.urgency]} · ${money.format(line.unitPrice)}/шт.`;
    total.textContent = money.format(line.total);
    remove.type = 'button';
    remove.textContent = 'Удалить';
    remove.ariaLabel = `Удалить артикул ${line.sku}`;
    remove.addEventListener('click', () => {
      order = order.filter(item => item.id !== line.id);
      renderOrder();
    });
    item.append(title, details, total, remove);
    root.append(item);
  });

  $('#order-total').textContent = money.format(orderTotal());
  $('#order-counter').textContent = order.length
    ? `${order.length} ${plural(order.length, 'позиция', 'позиции', 'позиций')}`
    : 'Пока нет позиций';
  ['#clear-order', '#download-excel', '#submit-order'].forEach(selector => {
    $(selector).disabled = !order.length;
  });
}

function plural(value, one, few, many) {
  const last = value % 10;
  const lastTwo = value % 100;
  return last === 1 && lastTwo !== 11
    ? one
    : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)
      ? few
      : many;
}

function orderTotal() {
  return roundMoney(order.reduce((sum, line) => sum + line.total, 0));
}

// Заявка уходит в Apps Script (doPost), а он пересылает её менеджеру в Telegram.
// Тело — строка без заголовка Content-Type: так браузер не делает CORS-предзапрос.
async function submitOrder() {
  const form = $('#contact-form');
  const button = form.querySelector('[value=submit]');
  const error = $('#contact-error');
  const fields = new FormData(form);
  const payload = {
    action: 'order',
    website: fields.get('website'),
    contact: { name: fields.get('name'), phone: fields.get('phone'), email: fields.get('email') },
    catalogVersion: data.version,
    total: orderTotal(),
    lines: order.map(line => ({
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  button.disabled = true;
  button.textContent = 'Отправляем…';
  error.hidden = true;
  try {
    const response = await fetch(apiUrl(), {
      method: 'POST',
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Сервер ответил с кодом ${response.status}`);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Сервер вернул не JSON');
    }
    if (!result?.ok) throw new Error(result?.error?.message ?? 'Заявка не отправлена');

    $('#contact-dialog').close();
    form.reset();
    toast('Заявка отправлена менеджеру.');
  } catch (reason) {
    const message = reason.name === 'AbortError' ? 'Сервер не ответил вовремя' : reason.message;
    error.textContent = `${message}. Если не получится, скачайте Excel и отправьте его менеджеру.`;
    error.hidden = false;
  } finally {
    clearTimeout(timeout);
    button.disabled = false;
    button.textContent = 'Отправить заявку';
  }
}

// Настоящий .xlsx через SheetJS (assets/vendor/xlsx.mini.min.js).
function downloadExcel() {
  const rows = [
    ['Компания', 'Артикул', 'Наименование', 'Тираж', 'Срочность', 'Цена за шт.', 'Сумма', 'Условия тиража'],
    ...order.map(line => [
      line.company,
      line.sku,
      line.name,
      line.quantity,
      urgencyLabels[line.urgency],
      line.unitPrice,
      line.total,
      conditionLabels[line.status]
    ])
  ];
  const total = orderTotal();
  rows.push(['', '', '', '', '', 'Итого', total, '']);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const lastRow = rows.length;
  sheet[`G${lastRow}`] = { t: 'n', v: total, f: `SUM(G2:G${lastRow - 1})` };
  for (let row = 2; row <= lastRow; row++) {
    if (sheet[`D${row}`]) sheet[`D${row}`].z = '#,##0';
    if (sheet[`F${row}`]?.t === 'n') sheet[`F${row}`].z = '#,##0.00 "₽"';
    sheet[`G${row}`].z = '#,##0.00 "₽"';
  }
  sheet['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 60 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 34 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Заявка');
  const today = new Date();
  const date = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
    .map(part => String(part).padStart(2, '0'))
    .join('-');
  XLSX.writeFile(book, `fbprint-order-${date}.xlsx`);
  toast('Excel-файл сформирован.');
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.hidden = true;
  }, 3200);
}

$('#article-search').addEventListener('input', event => renderSearch(event.target.value));
$('#article-search').addEventListener('focus', event => {
  if (event.target.value) renderSearch(event.target.value);
});
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
  article = null;
  renderSelected();
  $('#article-search').focus();
});
$('#quantity').addEventListener('input', renderCalculation);
$('#quantity').addEventListener('blur', () => {
  $('#quantity').value = quantity();
  renderCalculation();
});
$('#quantity-minus').addEventListener('click', () => {
  if (!article) return;
  const category = categories().get(article.categoryId);
  $('#quantity').value = Math.max(0, quantity() - category.multiple);
  renderCalculation();
});
$('#quantity-plus').addEventListener('click', () => {
  if (!article) return;
  const category = categories().get(article.categoryId);
  $('#quantity').value = quantity() + category.multiple;
  renderCalculation();
});
document.querySelectorAll('[name=urgency]').forEach(input => {
  input.addEventListener('change', renderCalculation);
});
$('#add-line').addEventListener('click', addLine);
$('#clear-order').addEventListener('click', () => {
  order = [];
  renderOrder();
  toast('Заявка очищена.');
});
$('#download-excel').addEventListener('click', downloadExcel);
$('#submit-order').addEventListener('click', () => {
  $('#dialog-demo-note').hidden = Boolean(apiUrl());
  $('#contact-error').hidden = true;
  $('#contact-dialog').showModal();
});
$('#close-contact-dialog').addEventListener('click', () => $('#contact-dialog').close());
$('#contact-form').addEventListener('submit', event => {
  if (event.submitter?.value !== 'submit') return;
  event.preventDefault();
  if (apiUrl()) {
    submitOrder();
    return;
  }
  $('#contact-dialog').close();
  $('#contact-form').reset();
  toast('Демонстрация: отправка менеджеру пока не подключена.');
});
$('#refresh-data').addEventListener('click', loadData);

const platform = navigator.userAgentData?.platform ?? navigator.platform ?? '';
$('#search-shortcut').textContent = /mac/i.test(platform) ? '⌘ K' : 'Ctrl K';

applyCatalog(data);
loadData();
