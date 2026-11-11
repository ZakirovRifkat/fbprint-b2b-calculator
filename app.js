// Вымышленный каталог для разработки (apiUrl пуст): настоящие цены и клиенты — только в таблице.
const demoCatalog = {
  schemaVersion: 1,
  version: 'demo',
  companies: [
    { id: 'demo_a', name: 'Демо-компания А' },
    { id: 'demo_b', name: 'Демо-компания Б' }
  ],
  categories: [
    {
      id: '1',
      size: '80 × 120 мм',
      color: 'Текст с фоном',
      minimumQuantity: 4000,
      rollQuantity: 1000,
      lanes: 4,
      multiple: 4000,
      prices: { standard: 1, urgent: 1.5, emergency: 2 },
      reducedRun: { minQuantity: 1000, maxQuantity: 3999, price: 1.4 }
    },
    {
      id: '2',
      size: '60 × 100 мм',
      color: 'Ч/Б',
      minimumQuantity: 6000,
      rollQuantity: 2000,
      lanes: 3,
      multiple: 6000,
      prices: { standard: 0.5, urgent: 0.75, emergency: 1 },
      reducedRun: { minQuantity: 2000, maxQuantity: 5999, price: 0.7 }
    },
    {
      id: '3',
      size: 'D80',
      color: 'Цветная',
      minimumQuantity: 5000,
      rollQuantity: 2500,
      lanes: 2,
      multiple: 2500,
      prices: { standard: 2, urgent: 3, emergency: 4 },
      reducedRun: null
    }
  ],
  articles: [
    { companyId: 'demo_a', sku: '1001', categoryId: '1', name: 'Демо-этикетка «Салат»' },
    { companyId: 'demo_a', sku: '1002', categoryId: '2', name: 'Демо-этикетка «Суп»' },
    { companyId: 'demo_a', sku: '1003', categoryId: '3', name: 'Демо-этикетка «Стикер»' },
    { companyId: 'demo_b', sku: '2001', categoryId: '1', name: 'Демо-этикетка «Сэндвич»' },
    { companyId: 'demo_b', sku: '2002', categoryId: '2', name: 'Демо-этикетка «Каша»' }
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
const freeDeliveryFrom = 100000;
const urgencyLabels = {
  standard: 'Стандартный',
  urgent: 'Срочный',
  emergency: 'Экстренный'
};
const conditionLabels = {
  good: 'Оптимальные условия',
  multiple: 'Требуется корректировка кратности',
  reduced: 'Сниженный тираж'
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

  // Артикул без категории — ещё не готов к продаже: не показываем его и не считаем ошибкой.
  const readyArticles = raw.articles.filter(item => String(item?.categoryId ?? '').trim());
  const articles = readyArticles.map(item => {
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

// Пароль выдаёт менеджер FB Print. Проверяет его Apps Script (свойство ACCESS_PASSWORD).
// С галочкой «Сохранить пароль» он лежит в localStorage и переживает закрытие браузера,
// без неё — в sessionStorage: переживает перезагрузку, но забывается вместе с вкладкой.
const passwordKey = 'fbprint-access-password';
const accessErrors = ['ACCESS_DENIED', 'ACCESS_NOT_CONFIGURED'];
let sessionPassword = '';

function readStorage(storage) {
  try {
    return storage.getItem(passwordKey) ?? '';
  } catch {
    return '';
  }
}

function writeStorage(storage, value) {
  try {
    if (value) storage.setItem(passwordKey, value);
    else storage.removeItem(passwordKey);
  } catch {
    // Хранилище недоступно (приватный режим) — пароль живёт до перезагрузки страницы.
  }
}

function accessPassword() {
  sessionPassword ||= readStorage(localStorage) || readStorage(sessionStorage);
  return sessionPassword;
}

function rememberPassword(value, persist) {
  sessionPassword = value;
  writeStorage(localStorage, persist ? value : '');
  writeStorage(sessionStorage, persist ? '' : value);
}

function forgetPassword() {
  sessionPassword = '';
  writeStorage(localStorage, '');
  writeStorage(sessionStorage, '');
}

function showPassword(visible) {
  $('#login-password').type = visible ? 'text' : 'password';
  $('#toggle-password').ariaPressed = String(visible);
  $('#toggle-password').ariaLabel = visible ? 'Скрыть пароль' : 'Показать пароль';
}

// Пока пароль проверяется, окно входа остаётся открытым, а кнопка «Войти» крутит загрузку.
function setLoginBusy(busy) {
  $('#login-submit').disabled = busy;
  $('#login-submit').ariaBusy = String(busy);
  $('#login-password').readOnly = busy;
}

// Экран «Загружаем каталог» — только при входе по сохранённому паролю.
// Пароль, введённый вручную, проверяется с загрузкой на кнопке «Войти».
function showPageLoader(visible) {
  $('#page-loader').hidden = !visible;
}

// При ошибке введённый пароль остаётся в поле выделенным — опечатку легко поправить.
// Если не подошёл сохранённый пароль, экран загрузки сменяется окном входа с ошибкой.
function askPassword(message = '') {
  showPageLoader(false);
  setLoginBusy(false);
  setDataStatus('locked', 'Нужен пароль');
  showCatalogError('');
  $('#login-error').textContent = message;
  $('#login-error').hidden = !message;
  if (!$('#login-dialog').open) {
    $('#login-password').value = '';
    showPassword(false);
    $('#login-dialog').showModal();
  }
  $('#login-password').focus();
  $('#login-password').select();
}

function closeLogin() {
  setLoginBusy(false);
  if ($('#login-dialog').open) $('#login-dialog').close();
}

async function loadData() {
  const url = apiUrl();
  if (!url) {
    showPageLoader(false);
    applyCatalog(normalizeCatalog(demoCatalog));
    setDataStatus('demo', 'Демо-данные');
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

  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
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

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('API вернул не JSON');
    }
    if (accessErrors.includes(payload?.error?.code)) {
      forgetPassword();
      applyCatalog(emptyCatalog);
      askPassword(payload.error.code === 'ACCESS_DENIED' && !typedPassword
        ? 'Сохранённый пароль больше не подходит — введите новый.'
        : payload.error.message);
      return;
    }

    closeLogin();
    applyCatalog(normalizeCatalog(payload));
    loadedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    setDataStatus('live', `Данные актуальны · ${loadedAt}`);
    showCatalogError('');
    loadOrders();
  } catch (error) {
    // Запрос отменён более новым нажатием «Обновить» — ошибки нет.
    if (controller !== loadController) return;
    // Пароль принят (или не проверен из-за сети) — ошибку каталога показываем на странице, а не в окне входа.
    closeLogin();
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
    // Запрос, отменённый более новым, экран не трогает — его уберёт новый запрос.
    if (controller === loadController) showPageLoader(false);
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
  // Пустой запрос: варианты показываем, только пока поле в фокусе, — иначе список не нужен.
  if (!query.trim() && document.activeElement !== $('#article-search')) {
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
    size.textContent = inOrder(item) ? 'Уже в заявке' : category?.size ?? '';
    button.disabled = inOrder(item);
    button.append(sku, name, size);
    button.addEventListener('click', () => selectArticle(item));
    root.append(button);
  });

  if (matches.length > items.length) {
    const more = document.createElement('div');
    more.className = 'search-more';
    more.textContent = query.trim()
      ? `Показаны ${items.length} из ${matches.length}. Уточните номер или название.`
      : `Показаны ${items.length} из ${matches.length}. Начните вводить номер или название.`;
    root.append(more);
  }

  root.hidden = false;
  $('#article-search').ariaExpanded = 'true';
}

// Один артикул — одна позиция: повторно его не выбрать и не добавить.
function lineKey(item) {
  return `${item.companyId}/${item.sku}`;
}

function inOrder(item) {
  return order.some(line => line.key === lineKey(item));
}

function selectArticle(nextArticle) {
  if (inOrder(nextArticle)) {
    toast('Этот артикул уже в заявке. Тираж можно изменить прямо в заявке.');
    return;
  }
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
    $('#quantity').value = '';
    $('#quantity').placeholder = '';
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
  // При выборе артикула — минимальный тираж; без артикула поле пустое.
  if (resetQuantity) $('#quantity').value = minimumValid(category);
  $('#quantity').placeholder = `от ${integer.format(category.reducedRun?.minQuantity ?? minimumValid(category))}`;
  renderCalculation();
}

function quantity() {
  return Math.max(0, Number(String($('#quantity').value).replace(/\D/g, '')) || 0);
}

// Наименьший тираж по обычной цене: минимум, приведённый к кратности.
function minimumValid(category) {
  return Math.ceil(category.minimumQuantity / category.multiple) * category.multiple;
}

// Три зоны тиража:
// 1) меньше «Сниженное кол-во от» (или минимума, если сниженного нет) — не принимаем;
// 2) сниженный тираж — цена «Стоимость сниженного тиража», только стандартный срок,
//    любое количество в диапазоне, кратность не проверяется;
// 3) от минимума — цена по срочности, кратность категории.
function quote(value, category, urgency) {
  const reduced = category.reducedRun;
  const minimum = minimumValid(category);
  const standard = category.prices.standard;

  if (value < (reduced ? reduced.minQuantity : category.minimumQuantity)
    || (reduced && value > reduced.maxQuantity && value < category.minimumQuantity)) {
    return {
      status: 'blocked',
      tone: 'danger',
      title: 'Тираж меньше минимального заказа',
      message: `Минимальный заказ — ${integer.format(reduced && value < reduced.minQuantity ? reduced.minQuantity : minimum)} шт.`,
      suggested: reduced && value < reduced.minQuantity ? reduced.minQuantity : minimum,
      canAdd: false,
      urgency: 'standard',
      unitPrice: null
    };
  }

  if (value < category.minimumQuantity) {
    // Клиенты сравнивают цену за штуку: выгода — сколько экономит каждая штука от минимума.
    const saving = roundMoney(reduced.price - standard);
    return {
      urgency: 'standard',
      unitPrice: reduced.price,
      canAdd: true,
      tone: 'warning',
      status: 'reduced',
      title: 'Сниженный тираж',
      message: `От ${integer.format(minimum)} шт. — ${money.format(standard)} за штуку. Срочный и экстренный заказ — от ${integer.format(minimum)} шт.`,
      benefit: saving > 0
        ? `Экономия ${money.format(saving)} на каждой штуке (−${Math.round(saving / reduced.price * 100)}%)`
        : null,
      suggested: minimum
    };
  }

  const base = { urgency, unitPrice: category.prices[urgency], canAdd: true };
  if (value % category.multiple !== 0) {
    const next = Math.ceil(value / category.multiple) * category.multiple;
    return {
      ...base,
      status: 'multiple',
      tone: 'warning',
      title: 'Тираж не соответствует кратности',
      message: `Для оптимальных условий необходимо привести количество к кратному ${integer.format(category.multiple)}. Ближайшее допустимое значение — ${integer.format(next)} шт.`,
      suggested: next
    };
  }
  return {
    ...base,
    status: 'good',
    tone: 'good',
    title: 'Соответствует оптимальным условиям',
    message: `Тираж не ниже минимума и кратен ${integer.format(category.multiple)}.`,
    suggested: null
  };
}

// Шаг кнопок «−» и «+»: в сниженном тираже — по «от», дальше — по кратности категории.
function stepQuantity(value, category, direction) {
  const reduced = category.reducedRun;
  const minimum = minimumValid(category);
  if (direction > 0) {
    if (reduced && value < category.minimumQuantity) {
      const next = (Math.floor(value / reduced.minQuantity) + 1) * reduced.minQuantity;
      return next > reduced.maxQuantity ? minimum : next;
    }
    return Math.max(minimum, (Math.floor(value / category.multiple) + 1) * category.multiple);
  }
  if (value > minimum) return Math.max(minimum, (Math.ceil(value / category.multiple) - 1) * category.multiple);
  if (!reduced) return minimum;
  const below = Math.min(value, reduced.maxQuantity + 1);
  return Math.max(reduced.minQuantity, (Math.ceil(below / reduced.minQuantity) - 1) * reduced.minQuantity);
}

function selectedUrgency() {
  return document.querySelector('[name=urgency]:checked')?.value ?? 'standard';
}

// Артикул выбран, количество ещё не введено: нейтральная подсказка без цены.
function renderEmptyQuantity(category) {
  const lowest = category.reducedRun?.minQuantity ?? minimumValid(category);
  document.querySelectorAll('[name=urgency]').forEach(input => {
    input.disabled = false;
    delete input.parentElement.dataset.tooltip;
  });
  $('#condition').dataset.state = 'idle';
  $('#condition-title').textContent = 'Укажите количество';
  $('#condition-message').textContent = `Минимальный заказ — ${integer.format(lowest)} шт.`;
  $('#condition-benefit').hidden = true;
  $('#apply-suggestion').hidden = true;
  $('#unit-price').textContent = '—';
  fitText($('#unit-price'));
  $('#line-quantity').textContent = '0 шт.';
  $('#line-total').textContent = '—';
  $('#minimum-value').textContent = integer.format(category.minimumQuantity);
  $('#multiple-value').textContent = integer.format(category.multiple);
  $('#reduced-value').textContent = category.reducedRun
    ? `${integer.format(category.reducedRun.minQuantity)}–${integer.format(category.reducedRun.maxQuantity)}`
    : 'нет';
  $('#add-line').disabled = true;
  $('#add-line').textContent = inOrder(article) ? 'Уже в заявке' : 'Добавить в заявку';
}

// Срочный и экстренный заказ — только от минимального тиража.
function syncUrgency(value, category) {
  const onlyStandard = value < category.minimumQuantity;
  document.querySelectorAll('[name=urgency]').forEach(input => {
    input.disabled = onlyStandard && input.value !== 'standard';
    if (input.disabled && input.checked) $('[name=urgency][value=standard]').checked = true;
    // Подсказка, почему срок недоступен: при наведении и при нажатии (на телефоне).
    if (input.disabled) {
      input.parentElement.dataset.tooltip = `${urgencyLabels[input.value]} заказ — от минимального тиража ${integer.format(minimumValid(category))} шт.`;
    } else {
      delete input.parentElement.dataset.tooltip;
    }
  });
}

function renderCalculation() {
  const condition = $('#condition');
  const apply = $('#apply-suggestion');
  if (!article) {
    condition.dataset.state = 'idle';
    $('#condition-benefit').hidden = true;
    $('#condition-title').textContent = 'Выберите артикул';
    $('#condition-message').textContent = 'После выбора появятся условия тиража.';
    apply.hidden = true;
    $('#line-total').textContent = '—';
    $('#line-quantity').textContent = '0 шт.';
    $('#unit-price').textContent = '—';
    $('#minimum-value').textContent = '—';
    $('#multiple-value').textContent = '—';
    $('#reduced-value').textContent = '—';
    $('#add-line').disabled = true;
    return;
  }

  const category = categories().get(article.categoryId);
  const value = quantity();
  if (!value) {
    renderEmptyQuantity(category);
    return;
  }
  syncUrgency(value, category);
  const result = quote(value, category, selectedUrgency());
  condition.dataset.state = result.tone;
  $('#condition-benefit').hidden = !result.benefit;
  $('#condition-benefit').textContent = result.benefit ?? '';
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
  // Клиенты сравнивают цену за штуку, поэтому крупно — она, а сумма позиции — мелко.
  $('#unit-price').textContent = result.canAdd ? money.format(result.unitPrice) : '—';
  fitText($('#unit-price'));
  $('#line-quantity').textContent = `${integer.format(value)} шт.`;
  $('#line-total').textContent = result.canAdd ? money.format(roundMoney(value * result.unitPrice)) : '—';
  $('#minimum-value').textContent = integer.format(category.minimumQuantity);
  $('#multiple-value').textContent = integer.format(category.multiple);
  $('#reduced-value').textContent = category.reducedRun
    ? `${integer.format(category.reducedRun.minQuantity)}–${integer.format(category.reducedRun.maxQuantity)}`
    : 'нет';
  const added = inOrder(article);
  $('#add-line').disabled = !result.canAdd || added;
  $('#add-line').textContent = added ? 'Уже в заявке' : 'Добавить в заявку';
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addLine() {
  if (!article) return;
  const category = categories().get(article.categoryId);
  const value = quantity();
  const result = quote(value, category, selectedUrgency());
  if (!result.canAdd) {
    toast(result.message);
    return;
  }
  if (inOrder(article)) {
    toast('Этот артикул уже в заявке.');
    return;
  }

  const line = makeLine(article, value, result);
  order.push(line);
  showLine(line);
  renderOrder();
  toast({
    good: 'Позиция добавлена в заявку.',
    reduced: 'Позиция добавлена по цене сниженного тиража.'
  }[result.status] ?? 'Позиция добавлена. Проверьте условия тиража.');
}

function lineNote(line) {
  if (line.status !== 'reduced' && line.status !== 'multiple') return null;
  const item = data.articles.find(entry => lineKey(entry) === line.key);
  const category = item && categories().get(item.categoryId);
  if (!category) return null;
  return line.status === 'reduced'
    ? { label: 'Сниженный тираж', hint: `От ${integer.format(minimumValid(category))} шт. — ${money.format(category.prices.standard)} за штуку` }
    : { label: 'Не кратно', hint: `Кратность ${integer.format(category.multiple)} шт.` };
}

function makeLine(item, value, result) {
  const category = categories().get(item.categoryId);
  const company = data.companies.find(entry => entry.id === item.companyId);
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
function changeLineQuantity(line, input) {
  const value = Math.max(0, Number(String(input.value).replace(/\D/g, '')) || 0);
  const item = data.articles.find(entry => lineKey(entry) === line.key);
  const category = item && categories().get(item.categoryId);
  const restore = () => { input.value = integer.format(line.quantity); };
  if (!category) {
    toast('Артикула больше нет в каталоге — тираж не изменить.');
    restore();
    return;
  }
  if (value === line.quantity) {
    restore();
    return;
  }
  const result = quote(value, category, value < category.minimumQuantity ? 'standard' : line.urgency);
  if (!result.canAdd) {
    toast(`${result.message} Тираж не изменён.`);
    restore();
    return;
  }
  const urgencyDropped = result.urgency !== line.urgency;
  flashLineId = line.id;
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
const orderFilter = { query: '', company: '', urgency: '', issue: '' };
let orderSort = { key: '', dir: 1 };
const urgencyRank = { standard: 0, urgent: 1, emergency: 2 };
const sortValue = {
  code: line => `${line.company} ${line.sku.padStart(12, '0')}`,
  name: line => line.name,
  quantity: line => line.quantity,
  urgency: line => urgencyRank[line.urgency],
  price: line => line.unitPrice,
  total: line => line.total
};

function filtersActive() {
  return Object.values(orderFilter).some(Boolean);
}

function visibleOrder() {
  const query = searchKey(orderFilter.query);
  const list = order.filter(line => {
    if (query && !searchKey(`${line.sku} ${line.name}`).includes(query)) return false;
    if (orderFilter.company && line.company !== orderFilter.company) return false;
    if (orderFilter.urgency && line.urgency !== orderFilter.urgency) return false;
    if (orderFilter.issue === 'issues' && line.status !== 'reduced' && line.status !== 'multiple') return false;
    if ((orderFilter.issue === 'reduced' || orderFilter.issue === 'multiple') && line.status !== orderFilter.issue) return false;
    return true;
  });
  if (!orderSort.key) return list;
  const value = sortValue[orderSort.key];
  // Сортировка устойчивая: при равных значениях сохраняется порядок добавления.
  return list
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const x = value(a.line);
      const y = value(b.line);
      const compare = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ru', { numeric: true });
      return compare * orderSort.dir || a.index - b.index;
    })
    .map(item => item.line);
}

function renderOrderTools(shownCount) {
  const tools = $('#order-tools');
  tools.hidden = order.length < 6 && !filtersActive();
  const companies = [...new Set(order.map(line => line.company))];
  const companySelect = $('#order-filter-company');
  const current = companySelect.value;
  companySelect.innerHTML = '<option value="">Все компании</option>';
  companies.forEach(name => companySelect.append(new Option(name, name)));
  companySelect.value = companies.includes(current) ? current : '';
  orderFilter.company = companySelect.value;
  companySelect.hidden = companies.length < 2;
  ['#order-filter-company', '#order-filter-urgency', '#order-filter-issue'].forEach(selector => $(selector).classList.toggle('is-active', Boolean($(selector).value)));
  $('#order-filter-reset').hidden = !filtersActive();
  $('#order-none').hidden = shownCount > 0 || !order.length;
  document.querySelectorAll('.order-table th[data-sort]').forEach(th => {
    if (th.dataset.sort === orderSort.key) th.setAttribute('aria-sort', orderSort.dir > 0 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
  const sortSelect = $('#order-sort-select');
  const sortCode = orderSort.key ? `${orderSort.key}:${orderSort.dir}` : '';
  if ([...sortSelect.options].some(option => option.value === sortCode)) sortSelect.value = sortCode;
}

function clearOrderFilters() {
  Object.keys(orderFilter).forEach(key => { orderFilter[key] = ''; });
  $('#order-search').value = '';
  ['#order-filter-company', '#order-filter-urgency', '#order-filter-issue'].forEach(selector => { $(selector).value = ''; });
}

function resetOrderFilters() {
  clearOrderFilters();
  orderPage = 1;
  renderOrder();
}

// Новая позиция должна быть видна: фильтры сбрасываются, открывается страница, где она стоит с учётом сортировки.
function showLine(line) {
  clearOrderFilters();
  const index = visibleOrder().indexOf(line);
  orderPage = orderPageSize ? Math.floor(index / orderPageSize) + 1 : 1;
}

// Таблица заявки — по страницам: 10 позиций по умолчанию, можно 25, 50 или все сразу.
let orderPage = 1;
let orderPageSize = 10;
// Строка, где только что изменили тираж: на секунду подсвечивается, чтобы было видно, что сумма пересчиталась.
let flashLineId = null;

function orderPageCount(count = visibleOrder().length) {
  return orderPageSize ? Math.max(1, Math.ceil(count / orderPageSize)) : 1;
}

// Номера страниц: первая, последняя и соседние с текущей, между ними — многоточие.
function pagerItems(current, total) {
  const pages = [...new Set([1, current - 1, current, current + 1, total])].filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
  return pages.flatMap((page, index) => (index && page - pages[index - 1] > 1 ? ['…', page] : [page]));
}

function renderPager(shownCount) {
  const pager = $('#order-pager');
  pager.hidden = order.length <= 10 || !shownCount;
  if (pager.hidden) return;
  const total = orderPageCount(shownCount);
  const first = orderPageSize ? (orderPage - 1) * orderPageSize + 1 : 1;
  const last = orderPageSize ? Math.min(shownCount, orderPage * orderPageSize) : shownCount;
  $('#order-range').textContent = `Позиции ${first}–${last} из ${shownCount}${shownCount < order.length ? ` (всего ${order.length})` : ''}`;
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
      orderPage = page;
      renderOrder();
    });
    return item;
  };
  root.append(button('‹', orderPage - 1));
  pagerItems(orderPage, total).forEach(item => root.append(item === '…' ? cell('span', '…') : button(String(item), item, item === orderPage)));
  root.append(button('›', orderPage + 1));
}

function renderOrder() {
  const empty = $('#order-empty');
  const root = $('#order-lines');
  empty.hidden = order.length > 0;
  root.innerHTML = '';

  $('#order-table').hidden = !order.length;
  const shown = visibleOrder();
  orderPage = Math.min(Math.max(1, orderPage), orderPageCount(shown.length));
  const visible = orderPageSize ? shown.slice((orderPage - 1) * orderPageSize, orderPage * orderPageSize) : shown;
  // Строка таблицы: компания и код, наименование, тираж (можно изменить), срок, цена за штуку, сумма, удалить.
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
      tag.className = 'line-tag line-tag--warn';
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
    remove.title = 'Удалить позицию';
    remove.ariaLabel = `Удалить артикул ${line.sku}`;
    remove.addEventListener('click', () => {
      order = order.filter(item => item.id !== line.id);
      renderOrder();
    });
    removeCell.append(remove);

    row.append(code, cell('td', line.name, 'name'), quantity, urgency, price, total, removeCell);
    if (line.id === flashLineId) row.className = 'line-flash';
    root.append(row);
  });

  flashLineId = null;
  renderOrderTools(shown.length);
  renderPager(shown.length);
  $('#order-total').textContent = money.format(orderTotal());
  fitText($('#order-total'));
  const delivery = $('#delivery-note');
  delivery.hidden = !order.length;
  delivery.dataset.free = String(orderTotal() >= freeDeliveryFrom);
  delivery.textContent = deliveryText();
  $('#order-counter').textContent = order.length
    ? `${order.length} ${plural(order.length, 'позиция', 'позиции', 'позиций')}`
    : 'Пока нет позиций';
  // Кнопка «Добавить» и пометки «Уже в заявке» зависят от состава заявки.
  renderCalculation();
  if (!$('#search-results').hidden) renderSearch($('#article-search').value);
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

// Суммы от 100 000 ₽ не помещаются крупным шрифтом: уменьшаем, пока строка не влезет.
function fitText(element) {
  element.style.fontSize = '';
  let size = parseFloat(getComputedStyle(element).fontSize);
  while (element.scrollWidth > element.clientWidth && size > 16) {
    size -= 1;
    element.style.fontSize = `${size}px`;
  }
}

function orderTotal() {
  return roundMoney(order.reduce((sum, line) => sum + line.total, 0));
}

// Правило из примечаний листа «Категории»: «Бесплатная доставка — при сумме счёта от 100 тыс. руб.».
function deliveryText() {
  const total = orderTotal();
  return total >= freeDeliveryFrom
    ? `Доставка бесплатная от ${money.format(freeDeliveryFrom)}.`
    : `До бесплатной доставки — ${money.format(roundMoney(freeDeliveryFrom - total))}. Сейчас доставка платная или самовывоз.`;
}

// Загрузка заявки списком: файл Excel клиента — перетаскиванием на зону или кнопкой «Выбрать файл».
// Формат таблицы свободный: сайт ищет строку заголовков с «Код» (или «Артикул») и столбец тиража
// («Тираж», «Заказ…, шт», «Количество»); название компании в заголовке задаёт компанию блока.
// Без заголовков: первый заполненный столбец — код, следующий с числом — тираж, компания — выбранная на сайте.
// Каждая строка проверяется теми же правилами, что и калькулятор (quote).
let importRows = [];
const importLabels = {
  good: 'Подходит',
  reduced: 'Сниженный тираж',
  multiple: 'Не кратно',
  blocked: 'Меньше минимума',
  missing: 'Нет в каталоге',
  duplicate: 'Повтор',
  inOrder: 'Уже в заявке'
};

const looseText = value => String(value ?? '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');

// Значение ячейки ExcelJS: формулы, форматированный текст и гиперссылки — к простому значению.
function cellValue(value) {
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

function skuText(value) {
  return String(value ?? '').trim().replace(/\.0+$/, '');
}

function quantityValue(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function urgencyValue(value) {
  const key = looseText(value);
  return key.includes('экстр') ? 'emergency' : key.includes('сроч') ? 'urgent' : 'standard';
}

function companyByName(value) {
  const key = looseText(value);
  return key ? data.companies.find(item => looseText(item.name) === key) ?? null : null;
}

function guessLayout(cells) {
  const filled = cells.map((value, index) => [value, index]).filter(([value]) => String(value).trim() !== '');
  const quantity = filled.slice(1).find(([value]) => quantityValue(value) > 0);
  if (!filled.length || !quantity) return null;
  const urgency = filled.slice(1).find(([value]) => /сроч|экстр|станд/i.test(String(value)));
  return { sku: filled[0][1], quantity: quantity[1], urgency: urgency ? urgency[1] : -1, companyId: null };
}

// rows — массив строк, строка — массив значений ячеек. Возвращает позиции {companyId, sku, quantity, urgency, source}.
function parseImportRows(rows, sourceName, fallbackCompanyId = null) {
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

async function readImportFile(file) {
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
function prepareImport(items) {
  const selected = companyId;
  const seen = new Map();
  importRows = items.map((item, index) => {
    let rowCompany = item.companyId ?? selected;
    let note = '';
    let found = data.articles.find(entry => entry.companyId === rowCompany && entry.sku === item.sku) ?? null;
    if (!found && !item.companyId) {
      const elsewhere = data.articles.filter(entry => entry.sku === item.sku);
      if (elsewhere.length === 1) {
        found = elsewhere[0];
        rowCompany = found.companyId;
        note = 'Компания определена по коду';
      }
    }
    const row = { id: index, companyId: rowCompany, sku: item.sku, article: found, quantity: item.quantity, urgency: item.urgency, source: item.source, note, duplicateOf: null };
    const key = `${rowCompany}/${item.sku}`;
    if (found && seen.has(key)) row.duplicateOf = seen.get(key);
    else seen.set(key, row);
    return row;
  });
}

function evaluateImportRow(row) {
  if (!row.article) return { kind: 'missing', canAdd: false, message: 'Проверьте код или попросите менеджера добавить артикул в каталог.' };
  if (row.duplicateOf) return { kind: 'duplicate', canAdd: false, message: `Этот код уже есть выше (${row.duplicateOf.source}).` };
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
function fixable(result) {
  return Boolean(result.suggested) && (result.kind === 'multiple' || result.kind === 'blocked');
}

function applyImportSuggestion(row, value) {
  row.quantity = value;
  renderImport();
}

function renderImport() {
  const body = $('#import-rows');
  body.innerHTML = '';
  const counts = {};
  let addable = 0;
  let total = 0;
  importRows.forEach(row => {
    const result = evaluateImportRow(row);
    counts[result.kind] = (counts[result.kind] ?? 0) + 1;
    if (result.canAdd) {
      addable += 1;
      total += roundMoney(row.quantity * result.unitPrice);
    }
    const tr = document.createElement('tr');
    tr.dataset.kind = result.kind;

    const company = data.companies.find(item => item.id === row.companyId);
    const code = cell('td', row.sku, 'code');
    code.prepend(cell('small', company?.name ?? '—'));
    code.append(cell('small', row.source));

    const quantity = document.createElement('td');
    quantity.className = 'num';
    const input = document.createElement('input');
    input.inputMode = 'numeric';
    input.value = integer.format(row.quantity);
    input.ariaLabel = `Тираж кода ${row.sku}`;
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
    if (result.urgencyDropped) box.append(cell('span', `${urgencyLabels[row.urgency]} срок — от минимального тиража, посчитано по стандартному.`));
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

    const price = cell('td', result.canAdd ? money.format(result.unitPrice) : '—');
    price.className = 'num';
    const sum = cell('td', result.canAdd ? money.format(roundMoney(row.quantity * result.unitPrice)) : '—');
    sum.className = 'num';
    tr.append(code, cell('td', row.article?.name ?? '—', 'name'), quantity, status, price, sum);
    body.append(tr);
  });

  const parts = ['good', 'reduced', 'multiple', 'blocked', 'missing', 'duplicate', 'inOrder']
    .filter(kind => counts[kind])
    .map(kind => `${importLabels[kind].toLocaleLowerCase('ru-RU')} — ${counts[kind]}`);
  $('#import-summary').textContent = `${importRows.length} ${plural(importRows.length, 'строка', 'строки', 'строк')}: ${parts.join(', ')}.`;
  const fixes = importRows.filter(row => fixable(evaluateImportRow(row))).length;
  $('#import-fix-all').disabled = !fixes;
  $('#import-fix-all').textContent = fixes ? `Исправить все по рекомендациям (${fixes})` : 'Исправлять нечего';
  const skipped = importRows.length - addable;
  $('#import-skipped').textContent = skipped
    ? `Не войдут в заявку: ${skipped} — нет в каталоге, повторы, уже в заявке или тираж меньше минимума.`
    : 'Все строки можно добавить.';
  const add = $('#import-add');
  add.disabled = !addable;
  add.textContent = addable
    ? `Добавить ${addable} ${plural(addable, 'позицию', 'позиции', 'позиций')} · ${money.format(roundMoney(total))}`
    : 'Нечего добавить';
}

async function importFile(file) {
  if (!file) return;
  if (!data.articles.length) {
    toast('Каталог ещё не загружен.');
    return;
  }
  if (!/\.xlsx$/i.test(file.name)) {
    toast('Нужен файл Excel в формате .xlsx.');
    return;
  }
  toast('Читаем файл…');
  try {
    const items = await readImportFile(file);
    if (!items.length) {
      toast('В файле не нашлось строк с кодом и тиражом. Нужны столбцы «Код» и «Тираж» (или «Заказ…, шт»).');
      return;
    }
    prepareImport(items);
    renderImport();
    markImportedFile(file.name, items.length);
    $('#import-dialog').showModal();
  } catch (error) {
    toast(error.message);
  }
}

// После загрузки зона показывает галочку, имя файла и число строк; кнопка — «Выбрать другой файл».
function markImportedFile(name, count) {
  const zone = $('#import-drop');
  zone.dataset.state = 'loaded';
  const textNode = $('#import-drop-text');
  textNode.innerHTML = '';
  textNode.append(cell('strong', 'Файл загружен:'), ` ${name} · ${count} ${plural(count, 'строка', 'строки', 'строк')}`);
  $('#import-file-button').textContent = 'Выбрать другой файл';
}

function addImportedLines() {
  let added = 0;
  importRows.forEach(row => {
    const result = evaluateImportRow(row);
    if (!result.canAdd) return;
    order.push(makeLine(row.article, row.quantity, result));
    added += 1;
  });
  const skipped = importRows.length - added;
  $('#import-dialog').close();
  clearOrderFilters();
  orderPage = 1;
  renderOrder();
  toast(`Добавлено ${added} ${plural(added, 'позиция', 'позиции', 'позиций')}${skipped ? `, пропущено ${skipped}` : ''}.`);
}

// Вкладка «Заявки»: все заявки с листа «Заявки» в таблице, новые сверху.
// Пароль один на всех, поэтому список общий для всех клиентов. Позиции заявки — в Telegram и Excel.
const statusLabels = { work: 'В работе', shipped: 'Отгружено' };
const dateTime = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
let ordersList = [];
let ordersLoaded = false;
let ordersFilter = 'all';
let ordersController = null;

// Раньше заявки хранились в браузере; теперь они в таблице, старую копию убираем.
try {
  localStorage.removeItem('fbprint-sent-orders');
} catch {
  // Хранилище недоступно — убирать нечего.
}

// «Отгружено» ставит менеджер в таблице (лист «Заявки», колонка E); всё остальное — «В работе».
function orderStatus(entry) {
  return entry.status === 'shipped' ? 'shipped' : 'work';
}

function renderOrders(list = ordersList) {
  const root = $('#sent-orders-list');
  root.innerHTML = '';
  const counts = { all: list.length, work: 0, shipped: 0 };
  list.forEach(entry => { counts[orderStatus(entry)] += 1; });
  Object.entries(counts).forEach(([filter, count]) => { $(`#filter-${filter}`).textContent = count; });
  document.querySelectorAll('.orders-filter button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.filter === ordersFilter));
  });
  const shown = list.filter(entry => ordersFilter === 'all' || orderStatus(entry) === ordersFilter);
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
  $('#orders-empty').hidden = !ordersLoaded || list.length > 0;
  $('#orders-toolbar').hidden = false;
  root.hidden = !shown.length;
  $('#orders-none').hidden = !list.length || shown.length > 0;
  $('#orders-none').textContent = ordersFilter === 'shipped' ? 'Отгруженных заявок пока нет.' : 'Все заявки отгружены.';
  $('#orders-count').textContent = list.length;
  $('#orders-count').hidden = !list.length;
}

function cell(tag, text, name) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (name) node.dataset.cell = name;
  return node;
}

// Список и статусы загружаются при входе, при открытии вкладки и после отправки заявки.
// Если таблица не ответила, остаётся последний загруженный список с пометкой.
async function loadOrders() {
  if (!apiUrl()) {
    ordersLoaded = true;
    renderOrders();
    $('#orders-sync').textContent = 'Демо-режим: заявки появятся после подключения таблицы.';
    return;
  }
  const password = accessPassword();
  if (!password) return;
  ordersController?.abort();
  const controller = new AbortController();
  ordersController = controller;
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
    ordersList = payload.orders;
    ordersLoaded = true;
    renderOrders();
    $('#orders-sync').textContent = `Обновлено · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    if (controller !== ordersController) return;
    ordersLoaded = true;
    renderOrders();
    $('#orders-sync').textContent = ordersList.length
      ? 'Не удалось обновить заявки — показан последний загруженный список.'
      : 'Не удалось загрузить заявки. Нажмите «Обновить».';
    console.warn('Заявки не загружены:', error);
  } finally {
    clearTimeout(timeout);
  }
}

// Вкладки в шапке. Раздел задаёт адрес: #orders — заявки, всё остальное — расчёт.
// Так работают кнопка «Назад» и ссылка на раздел.
function showView() {
  const view = location.hash === '#orders' ? 'orders' : 'calc';
  $('#top').hidden = view !== 'calc';
  $('#orders-view').hidden = view !== 'orders';
  document.querySelectorAll('.view-tabs a').forEach(tab => {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  document.title = view === 'orders' ? 'FB Print — Заявки' : 'FB Print — Расчёт стоимости';
}

function openOrderDialog() {
  const companies = [...new Set(order.map(line => line.company))].join(', ');
  $('#order-summary').textContent = `${order.length} ${plural(order.length, 'позиция', 'позиции', 'позиций')} на сумму ${money.format(orderTotal())}. Компания: ${companies}.`;
  $('#dialog-demo-note').hidden = Boolean(apiUrl());
  $('#order-error').hidden = true;
  $('#order-confirm').hidden = false;
  $('#order-sent').hidden = true;
  $('#order-dialog').showModal();
}

// Заявка уходит в Apps Script (doPost), а он пересылает её менеджеру в Telegram.
// Тело — строка без заголовка Content-Type: так браузер не делает CORS-предзапрос.
// Персональные данные не передаются: только номер, компания и позиции.
async function submitOrder() {
  const form = $('#order-form');
  const button = form.querySelector('[value=submit]');
  const error = $('#order-error');
  const payload = {
    action: 'order',
    password: accessPassword(),
    website: new FormData(form).get('website'),
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

  button.disabled = true;
  button.textContent = 'Отправляем…';
  // Та же таблица, что скачивает клиент, — менеджер получит её файлом вместе с заявкой.
  // Без файла заявка всё равно уйдёт: текст сообщения содержит все позиции.
  try {
    payload.file = await orderFileBase64();
  } catch (reason) {
    console.warn('Excel к заявке не приложен:', reason);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
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

    // Номер выдаёт Apps Script по листу «Заявки»: FB-0001 от 09.11.2026, FB-0002 от …
    const number = String(result.number ?? '');
    loadOrders();
    $('#order-number').textContent = number;
    $('#order-confirm').hidden = true;
    $('#order-sent').hidden = false;
    $('#order-done').focus();
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

// ExcelJS (~950 КБ) грузится только при первой выгрузке, а не вместе со страницей.
function loadExcelJs() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  loadExcelJs.promise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'assets/vendor/exceljs.min.js';
    script.onload = () => resolve(window.ExcelJS);
    script.onerror = () => {
      loadExcelJs.promise = null;
      script.remove();
      reject(new Error('Не удалось загрузить модуль Excel'));
    };
    document.head.append(script);
  });
  return loadExcelJs.promise;
}

// .xlsx с рамками: по листу на каждую компанию из заявки.
// Колонки: срочность, артикул, наименование, тираж, стоимость за штуку, итого;
// последняя — размер, скрыта: её можно развернуть в Excel при необходимости.
async function buildOrderWorkbook() {
  const ExcelJS = await loadExcelJs();
  const book = new ExcelJS.Workbook();
  const companies = [...new Set(order.map(line => line.company))];
  companies.forEach(company => addCompanySheet(book, company, order.filter(line => line.company === company)));
  return book;
}

function addCompanySheet(book, company, lines) {
  // Excel не разрешает в названии листа символы []:*?/\ и длину больше 31.
  const sheet = book.addWorksheet(company.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  sheet.columns = [
    { header: 'Срочность', key: 'urgency', width: 14 },
    { header: 'Артикул', key: 'sku', width: 11 },
    { header: 'Наименование', key: 'name', width: 60 },
    { header: 'Тираж', key: 'quantity', width: 12 },
    { header: 'Стоимость за шт.', key: 'unitPrice', width: 17 },
    { header: 'Итого', key: 'total', width: 16 },
    { header: 'Размер', key: 'size', width: 14, hidden: true }
  ];
  lines.forEach((line, index) => {
    const row = index + 2;
    sheet.addRow({
      urgency: urgencyLabels[line.urgency],
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: { formula: `ROUND(D${row}*E${row},2)`, result: line.total },
      size: line.size ?? ''
    });
  });
  const lastLine = lines.length + 1;
  const totalRow = sheet.addRow({
    unitPrice: 'Итого',
    total: { formula: `SUM(F2:F${lastLine})`, result: roundMoney(lines.reduce((sum, line) => sum + line.total, 0)) }
  });

  const border = { style: 'thin', color: { argb: 'FF9A97AD' } };
  sheet.eachRow(row => {
    for (let column = 1; column <= 7; column++) {
      const cell = row.getCell(column);
      cell.border = { top: border, left: border, bottom: border, right: border };
      cell.alignment = { vertical: 'top', wrapText: column === 3 };
    }
  });
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEBF3' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  sheet.getColumn('quantity').numFmt = '#,##0';
  sheet.getColumn('unitPrice').numFmt = '#,##0.00 "₽"';
  sheet.getColumn('total').numFmt = '#,##0.00 "₽"';
  totalRow.font = { bold: true };
  totalRow.getCell('unitPrice').alignment = { horizontal: 'right' };
}

async function orderFileBase64() {
  const bytes = new Uint8Array(await (await buildOrderWorkbook()).xlsx.writeBuffer());
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

async function downloadExcel() {
  try {
    const book = await buildOrderWorkbook();
    const buffer = await book.xlsx.writeBuffer();
    const today = new Date();
    const date = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
      .map(part => String(part).padStart(2, '0'))
      .join('-');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    link.download = `fbprint-order-${date}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    toast('Excel-файл сформирован.');
  } catch (error) {
    toast(`${error.message}. Попробуйте ещё раз.`);
  }
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
  article = null;
  renderSelected();
  $('#article-search').focus();
});
$('#quantity').addEventListener('input', renderCalculation);
$('#quantity').addEventListener('blur', () => {
  $('#quantity').value = quantity() || '';
  renderCalculation();
});
$('#quantity-minus').addEventListener('click', () => {
  if (!article) return;
  $('#quantity').value = stepQuantity(quantity(), categories().get(article.categoryId), -1);
  renderCalculation();
});
$('#quantity-plus').addEventListener('click', () => {
  if (!article) return;
  $('#quantity').value = stepQuantity(quantity(), categories().get(article.categoryId), 1);
  renderCalculation();
});
document.querySelectorAll('[name=urgency]').forEach(input => {
  input.addEventListener('change', renderCalculation);
  input.parentElement.addEventListener('click', () => {
    if (input.disabled && input.parentElement.dataset.tooltip) toast(input.parentElement.dataset.tooltip);
  });
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
  importRows.forEach(row => {
    const result = evaluateImportRow(row);
    if (fixable(result)) row.quantity = result.suggested;
  });
  renderImport();
});
$('#import-add').addEventListener('click', addImportedLines);
$('#order-search').addEventListener('input', event => {
  orderFilter.query = event.target.value;
  orderPage = 1;
  renderOrder();
});
[['#order-filter-company', 'company'], ['#order-filter-urgency', 'urgency'], ['#order-filter-issue', 'issue']].forEach(([selector, key]) => {
  $(selector).addEventListener('change', event => {
    orderFilter[key] = event.target.value;
    orderPage = 1;
    renderOrder();
  });
});
$('#order-filter-reset').addEventListener('click', resetOrderFilters);
$('#order-none-reset').addEventListener('click', resetOrderFilters);
// Клик по заголовку: по возрастанию → по убыванию → порядок добавления.
document.querySelectorAll('.order-table th[data-sort] .sort-button').forEach(button => button.addEventListener('click', () => {
  const key = button.parentElement.dataset.sort;
  orderSort = orderSort.key !== key ? { key, dir: 1 } : orderSort.dir > 0 ? { key, dir: -1 } : { key: '', dir: 1 };
  orderPage = 1;
  renderOrder();
}));
$('#order-sort-select').addEventListener('change', event => {
  const [key, dir] = event.target.value.split(':');
  orderSort = { key: key || '', dir: Number(dir) || 1 };
  orderPage = 1;
  renderOrder();
});
$('#order-page-size').addEventListener('change', event => {
  orderPageSize = Number(event.target.value);
  orderPage = 1;
  renderOrder();
});
$('#close-import-dialog').addEventListener('click', () => $('#import-dialog').close());
$('#clear-order').addEventListener('click', () => {
  order = [];
  renderOrder();
  toast('Заявка очищена.');
});
$('#download-excel').addEventListener('click', downloadExcel);
$('#submit-order').addEventListener('click', openOrderDialog);
$('#close-order-dialog').addEventListener('click', () => $('#order-dialog').close());
$('#order-done').addEventListener('click', () => $('#order-dialog').close());
$('#order-form').addEventListener('submit', event => {
  if (event.submitter?.value !== 'submit') return;
  event.preventDefault();
  if (apiUrl()) {
    submitOrder();
    return;
  }
  $('#order-dialog').close();
  toast('Демонстрация: отправка менеджеру пока не подключена.');
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

applyCatalog(data);
renderOrders();
showView();
window.addEventListener('hashchange', () => {
  showView();
  window.scrollTo(0, 0);
  if (location.hash === '#orders') loadOrders();
});
document.querySelectorAll('.orders-filter button').forEach(button => button.addEventListener('click', () => {
  ordersFilter = button.dataset.filter;
  renderOrders();
}));
loadData();
