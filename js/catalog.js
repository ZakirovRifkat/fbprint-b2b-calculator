// Каталог: демо-данные и проверка того, что пришло из таблицы.
import { state } from './state.js';
import { $, roundMoney } from './format.js';

// Вымышленный каталог для разработки (apiUrl пуст): настоящие цены и клиенты — только в таблице.
export const demoCatalog = {
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

export const emptyCatalog = { schemaVersion: 1, version: '', companies: [], categories: [], articles: [] };

// path — где ошибка, словами из таблицы: «Категория 7: «Стоимость»».
export function text(value, path) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${path} — не заполнено`);
  return result;
}

export function number(value, path, { integerOnly = false, optional = false } = {}) {
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

export function price(value, path) {
  const result = roundMoney(number(value, path));
  if (result <= 0) throw new Error(`${path} — нужно число больше нуля`);
  return result;
}

export function ensureUnique(items, key, describe) {
  const seen = new Set();
  items.forEach(item => {
    const value = key(item);
    if (seen.has(value)) throw new Error(`${describe(item)} встречается дважды`);
    seen.add(value);
  });
}

export function normalizeCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('каталог пришёл в неверном формате');
  }
  if (raw.error) {
    throw new Error(String(raw.error.message ?? raw.error));
  }
  if (!Array.isArray(raw.companies) || !Array.isArray(raw.categories) || !Array.isArray(raw.articles)) {
    throw new Error('в каталоге нет списков компаний, категорий или артикулов');
  }

  const schemaVersion = Number(raw.schemaVersion ?? 1);
  if (schemaVersion !== 1) {
    throw new Error(`сайт не знает версию каталога ${schemaVersion}`);
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
      size: text(category?.size, `${where}: «Размер этикетки»`).replace(/(\d)\s*[xхXХ*×]\s*(?=\d)/g, '$1 × '),
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

  if (!companies.length || !categories.length) throw new Error('в каталоге нет компаний или категорий');
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

export function normalizeReducedRun(reducedRun, where) {
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

export const categories = () => new Map(state.data.categories.map(item => [item.id, item]));
