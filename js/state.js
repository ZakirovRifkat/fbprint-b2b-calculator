// Общее состояние страницы. Модули меняют его через state.имя:
// импортированную переменную ES-модуль переназначить не может.
import { emptyCatalog } from './catalog.js';

export const state = {
  data: emptyCatalog,
  companyId: '',
  article: null,
  order: [],
  loadController: null,
  loadedAt: null,
  orderFooterVisible: false,
  sessionPassword: '',
  orderSort: { key: '', dir: 1 },
  orderPage: 1,
  orderPageSize: 10,
  flashLineId: null,
  importRows: [],
  ordersList: [],
  ordersLoaded: false,
  ordersFilter: 'all',
  ordersController: null
};
