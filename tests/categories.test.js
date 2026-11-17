// js/categories.js: числа из формы, что посчитает таблица, подтверждение смены цен, значения для правки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDocument } from './fake-dom.js';

installFakeDocument();
const { categoryFormValues, categoryPreview, formNumber, priceChanges } = await import('../js/categories.js');

test('formNumber: запятая, пробелы, пусто и мусор', () => {
  assert.equal(formNumber('1,13'), 1.13);
  assert.equal(formNumber(' 8 000 '), 8000);
  assert.equal(formNumber(''), null);
  assert.equal(formNumber('0'), null);
  assert.equal(formNumber('abc'), null);
  assert.equal(formNumber('-5'), null);
});

test('categoryPreview: формулы таблицы — срочно ×1,5, сниженный ×1,35, «до» = минимум − 1, пустые H и O по умолчанию', () => {
  const preview = categoryPreview({ price: '2', minimum: '4000', roll: '1000', lanes: '3', multiple: '', reducedFrom: '' });
  assert.equal(preview.urgent, 3);
  assert.ok(Math.abs(preview.reducedPrice - 2.7) < 1e-9);
  assert.equal(preview.multiple, 3000);
  assert.equal(preview.reducedFrom, 1000);
  assert.equal(preview.reducedTo, 3999);
  const manual = categoryPreview({ price: '', minimum: '', roll: '1000', lanes: '', multiple: '500', reducedFrom: '800' });
  assert.deepEqual([manual.urgent, manual.multiple, manual.reducedFrom, manual.reducedTo], [null, 500, 800, null]);
  assert.deepEqual([manual.multipleByFormula, manual.reducedFromByFormula], [null, 1000]);
});

test('priceChanges: только изменённые цены, со срочной и сниженной', () => {
  const category = { price: 1.13, emergency: 2.26 };
  assert.deepEqual(priceChanges(category, { price: '1,13', emergency: '2,26' }), []);
  const plainSpaces = list => list.map(item => item.replace(/\s/g, ' '));
  const changes = plainSpaces(priceChanges(category, { price: '1,2', emergency: '2,26' }));
  assert.equal(changes.length, 3);
  assert.match(changes[0], /^Стоимость: 1,13 ₽ → 1,20 ₽$/);
  assert.match(changes[1], /^Срочный заказ: /);
  assert.match(changes[2], /^Сниженный тираж: /);
  assert.deepEqual(plainSpaces(priceChanges(category, { price: '1,13', emergency: '3' })), ['Экстренный заказ: 2,26 ₽ → 3,00 ₽']);
});

test('categoryFormValues: формулы — пустые поля, числа с запятой', () => {
  const values = categoryFormValues({ size: '60 х 100', color: 'Ч/Б', price: 1.13, emergency: 2.26, minimum: 4000, roll: 2000, lanes: null, multiple: 4000, multipleFormula: true, reducedFrom: 1000, reducedFromFormula: false });
  assert.deepEqual(values, { size: '60 х 100', color: 'Ч/Б', price: '1,13', emergency: '2,26', minimum: '4000', roll: '2000', lanes: '', multiple: '', reducedFrom: '1000' });
});
