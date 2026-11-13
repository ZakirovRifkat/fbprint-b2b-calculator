import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryText, filtersActive, lineNote, makeLine, orderFilter, orderHasProblems, orderKey,
  orderPageCount, orderTotal, pagerItems, readSavedOrder, repriceOrder, saveOrder, visibleOrder
} from '../js/order.js';
import { quote } from '../js/pricing.js';
import { state } from '../js/state.js';
import { article, brokenStorage, category, installDom, memoryStorage, plain, setStorage, useDemoCatalog } from './helpers.js';

const $ = installDom();

beforeEach(() => {
  useDemoCatalog('demo_a');
  Object.keys(orderFilter).forEach(key => { orderFilter[key] = ''; });
  state.orderSort = { key: '', dir: 1 };
  state.orderPageSize = 10;
  $('#toast').hidden = true;
  $('#toast-text').textContent = '';
});

const line = (sku, quantity, urgency = 'standard') => {
  const item = article(sku);
  return makeLine(item, quantity, quote(quantity, category(item.categoryId), urgency));
};

test('makeLine собирает строку заявки из артикула и расчёта', () => {
  const result = line('1001', 4000, 'urgent');
  assert.equal(result.key, 'demo_a/1001');
  assert.equal(result.company, 'Демо-компания А');
  assert.equal(result.name, 'Демо-этикетка «Салат»');
  assert.equal(result.size, '80 × 120 мм');
  assert.equal(result.urgency, 'urgent');
  assert.equal(result.unitPrice, 1.5);
  assert.equal(result.total, 6000);
  assert.equal(result.status, 'good');
  assert.ok(result.id);
});

test('makeLine округляет сумму до копейки', () => {
  assert.equal(line('1002', 2001).total, 1400.7);
});

test('orderTotal и подсказка о доставке', () => {
  state.order = [line('1001', 4000), line('1002', 6000)];
  assert.equal(orderTotal(), 7000);
  assert.equal(plain(deliveryText()), 'До бесплатной доставки — 93 000,00 ₽. Сейчас доставка платная или самовывоз.');
  state.order = [line('1001', 100000)];
  assert.equal(plain(deliveryText()), 'Доставка бесплатная от 100 000,00 ₽.');
});

test('repriceOrder обновляет цены по каталогу и сообщает об этом', () => {
  const stale = { ...line('1001', 4000), unitPrice: 0.9, total: 3600 };
  state.order = [stale];
  repriceOrder();
  assert.equal(stale.unitPrice, 1);
  assert.equal(stale.total, 4000);
  assert.equal($('#toast-text').textContent, 'Цены в заявке обновлены: 1 позиция.');
});

test('repriceOrder молчит, если цены не изменились', () => {
  state.order = [line('1001', 4000)];
  repriceOrder();
  assert.equal($('#toast').hidden, true);
});

test('repriceOrder помечает строки, которые нельзя заказать', () => {
  const gone = { ...line('1001', 4000), key: 'demo_a/0000' };
  const small = { ...line('1002', 6000), quantity: 500 };
  state.order = [gone, small, line('1003', 5000)];
  repriceOrder();
  assert.equal(gone.problem.label, 'Нет в каталоге');
  assert.equal(small.problem.label, 'Тираж мал');
  assert.match(plain(small.problem.hint), /Минимальный заказ — 2 000 шт\./);
  assert.equal(state.order[2].problem, undefined);
  assert.equal($('#toast-text').textContent, '2 позиции в заявке нельзя заказать: причина указана в строке.');
});

test('repriceOrder снимает пометку, когда строку снова можно заказать', () => {
  const fixed = { ...line('1001', 4000), problem: { label: 'Тираж мал', hint: '' } };
  state.order = [fixed];
  repriceOrder();
  assert.equal(fixed.problem, undefined);
});

test('repriceOrder переводит сниженный тираж на стандартный срок', () => {
  const urgent = { ...line('1001', 4000, 'urgent'), quantity: 2000 };
  state.order = [urgent];
  repriceOrder();
  assert.equal(urgent.urgency, 'standard');
  assert.equal(urgent.unitPrice, 1.4);
  assert.equal(urgent.status, 'reduced');
});

test('repriceOrder без каталога ничего не трогает', () => {
  const stale = { ...line('1001', 4000), unitPrice: 0.9 };
  state.order = [stale];
  state.data = { ...state.data, companies: [] };
  repriceOrder();
  assert.equal(stale.unitPrice, 0.9);
});

test('orderHasProblems не даёт отправить заявку с помеченной строкой', () => {
  state.order = [line('1001', 4000)];
  assert.equal(orderHasProblems(), false);
  state.order[0].problem = { label: 'Нет в каталоге', hint: '' };
  assert.equal(orderHasProblems(), true);
  assert.equal($('#toast').hidden, false);
});

test('lineNote: пометка проблемы, сниженный тираж, кратность', () => {
  const problem = { ...line('1001', 4000), problem: { label: 'Нет в каталоге', hint: 'x' } };
  assert.deepEqual(lineNote(problem), { label: 'Нет в каталоге', hint: 'x', tone: 'danger' });
  assert.equal(lineNote(line('1001', 4000)), null);
  assert.equal(lineNote(line('1001', 2000)).label, 'Сниженный тираж');
  assert.equal(plain(lineNote(line('1003', 7000)).hint), 'Кратность 2 500 шт.');
});

test('visibleOrder фильтрует по поиску, компании, сроку и пометкам', () => {
  const salad = line('1001', 4000, 'urgent');
  const soup = { ...line('1002', 2000), name: 'Ёжик' };
  const sandwich = { ...line('1003', 7000), company: 'Демо-компания Б' };
  state.order = [salad, soup, sandwich];

  assert.equal(filtersActive(), false);
  orderFilter.query = 'ежик';
  assert.deepEqual(visibleOrder(), [soup]);
  assert.equal(filtersActive(), true);
  orderFilter.query = '';

  orderFilter.company = 'Демо-компания Б';
  assert.deepEqual(visibleOrder(), [sandwich]);
  orderFilter.company = '';

  orderFilter.urgency = 'urgent';
  assert.deepEqual(visibleOrder(), [salad]);
  orderFilter.urgency = '';

  orderFilter.issue = 'issues';
  assert.deepEqual(visibleOrder(), [soup, sandwich]);
  orderFilter.issue = 'multiple';
  assert.deepEqual(visibleOrder(), [sandwich]);
});

test('visibleOrder сортирует коды как числа, а равные строки оставляет по порядку', () => {
  const a = { ...line('1001', 4000), sku: '10' };
  const b = { ...line('1002', 6000), sku: '2' };
  const c = { ...line('1003', 5000), sku: '3', company: 'Демо-компания Б' };
  state.order = [a, b, c];

  state.orderSort = { key: 'code', dir: 1 };
  assert.deepEqual(visibleOrder(), [b, a, c]);

  state.orderSort = { key: 'quantity', dir: -1 };
  assert.deepEqual(visibleOrder(), [b, c, a]);

  state.orderSort = { key: 'total', dir: 1 };
  const same = { ...a, id: 'same' };
  state.order = [a, same];
  assert.deepEqual(visibleOrder(), [a, same]);
});

test('orderPageCount считает страницы по размеру страницы', () => {
  assert.equal(orderPageCount(0), 1);
  assert.equal(orderPageCount(10), 1);
  assert.equal(orderPageCount(25), 3);
  state.orderPageSize = 0;
  assert.equal(orderPageCount(100), 1);
});

test('pagerItems: первая, последняя, соседние и многоточие', () => {
  assert.deepEqual(pagerItems(1, 1), [1]);
  assert.deepEqual(pagerItems(1, 3), [1, 2, 3]);
  assert.deepEqual(pagerItems(1, 5), [1, 2, '…', 5]);
  assert.deepEqual(pagerItems(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pagerItems(5, 10), [1, '…', 4, 5, 6, '…', 10]);
  assert.deepEqual(pagerItems(10, 10), [1, '…', 9, 10]);
});

test('заявка сохраняется в браузере и читается обратно', () => {
  setStorage('localStorage', memoryStorage());
  state.order = [line('1001', 4000)];
  saveOrder();
  assert.deepEqual(readSavedOrder(), state.order);
});

test('readSavedOrder отбрасывает испорченные строки и испорченный JSON', () => {
  const storage = memoryStorage();
  setStorage('localStorage', storage);
  storage.setItem(orderKey, JSON.stringify([{ id: '1', key: 'demo_a/1001', quantity: 4000 }, { id: '2', key: '' }, null, { id: '3', key: 'k', quantity: 0 }]));
  assert.deepEqual(readSavedOrder().map(item => item.id), ['1']);
  storage.setItem(orderKey, '{"not":"a list"}');
  assert.deepEqual(readSavedOrder(), []);
  storage.setItem(orderKey, '{сломано');
  assert.deepEqual(readSavedOrder(), []);
});

test('без доступа к хранилищу заявка не падает', () => {
  setStorage('localStorage', brokenStorage());
  assert.deepEqual(readSavedOrder(), []);
  assert.doesNotThrow(saveOrder);
});
