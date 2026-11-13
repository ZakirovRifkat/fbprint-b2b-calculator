// Заглушки браузера для тестов в Node: документ, хранилища, демо-каталог.
import { state } from '../js/state.js';
import { demoCatalog, normalizeCatalog } from '../js/catalog.js';

// Пробелы в числах Intl — неразрывные. Для сравнения приводим их к обычным.
export const plain = value => String(value).replace(/[  ]/g, ' ');

// Документ, где каждый селектор возвращает свой простой объект.
// Хватает тостов: модулям нужны только textContent, hidden и dataset.
export function installDom() {
  const elements = new Map();
  const element = () => ({
    textContent: '',
    hidden: true,
    value: '',
    dataset: {},
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    focus() {}
  });
  globalThis.document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    querySelectorAll: () => []
  };
  return selector => globalThis.document.querySelector(selector);
}

export function memoryStorage() {
  const items = new Map();
  return {
    getItem: key => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key)
  };
}

export function brokenStorage() {
  const fail = () => {
    throw new Error('storage is disabled');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

export function setStorage(name, storage) {
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
}

export const rawCatalog = () => structuredClone(demoCatalog);

export function useDemoCatalog(companyId = 'demo_a') {
  state.data = normalizeCatalog(rawCatalog());
  state.companyId = companyId;
  state.order = [];
  return state.data;
}

export const category = id => state.data.categories.find(item => item.id === id);
export const article = sku => state.data.articles.find(item => item.sku === sku);
