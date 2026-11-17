// Категории администратором: categoryRows, saveCategory, deleteCategory в поддельном Apps Script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GF, TEST_PASSWORDS, defaultSheets, loadCodeGs, makeSheet, plain } from './gas-harness.js';

const ADMIN = TEST_PASSWORDS.admin;
const CLIENT = TEST_PASSWORDS.client;
const CAT = 'Категории';

// Как в настоящей таблице: две категории, пустая строка, примечания. H и O — формулы во второй строке.
function sheets() {
  const all = defaultSheets();
  const header = ['Категория', 'Размер', 'Цветность', 'Стоимость', 'Минимальный', 'В роле', 'Ручьёв', 'Кратность', '', 'Экстренный', '', 'Срочный', '', 'Сниженное', '', '', '', 'Цена сниженного'];
  const sheet = makeSheet(CAT, [
    header,
    [1, '80 х 120', 'Цветная', 2, 1000, 500, 2, 1000, '', 4, '', 3, '', 'от', 500, 'до', 999, 2.7],
    [2, '60 х 100', 'Ч/Б', 1.13, 4000, 2000, 2, 4000, '', 2.26, '', 1.695, '', 'от', 1000, 'до', 3999, 1.5255],
    [],
    ['', '* - при заказе минимального тиража и больше']
  ]);
  sheet.formulas.set('3,8', '=F3*G3');
  sheet.formulas.set('3,12', '=D3*1.5');
  sheet.formulas.set('2,15', '=F2');
  all[CAT] = sheet;
  return all;
}

const category = (over = {}) => ({ size: '50 х 90', color: 'Цветная', price: '1,40', emergency: '2,8', minimum: '6000', roll: '1500', lanes: '2', multiple: '', reducedFrom: '', ...over });
const call = (h, body) => h.call({ password: ADMIN, ...body });

test('категории: только администратору', () => {
  const h = loadCodeGs({ sheets: sheets() });
  ['categoryRows', 'saveCategory', 'deleteCategory'].forEach(action => {
    assert.equal(h.call({ action, password: CLIENT, row: 2, id: '1', category: category() }).error.code, 'ADMIN_REQUIRED');
  });
});

test('categoryRows: строки категорий без примечаний, формулы отмечены, счёт артикулов', () => {
  const h = loadCodeGs({ sheets: sheets() });
  h.sheets[GF].data[3][0] = 2; // один артикул ГФ — в категории 2
  const reply = call(h, { action: 'categoryRows' });
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.categories.map(c => [c.row, c.id]), [[2, '1'], [3, '2']]);
  const [first, second] = reply.categories;
  assert.equal(first.multipleFormula, false);
  assert.equal(first.reducedFromFormula, true);
  assert.equal(second.multipleFormula, true);
  assert.equal(second.price, 1.13);
  assert.equal(second.urgent, 1.695);
  assert.equal(second.articles, 1);
  assert.ok(first.articles > 0);
  assert.equal(reply.nextId, 3);
});

test('saveCategory: новая категория — строка под последней, над примечаниями, со следующим номером и формулами', () => {
  const h = loadCodeGs({ sheets: sheets() });
  const reply = call(h, { action: 'saveCategory', category: category() });
  assert.equal(reply.ok, true);
  assert.deepEqual([reply.row, reply.id], [4, '3']);
  const sheet = h.sheets[CAT];
  assert.deepEqual(plain(sheet.data[3].slice(0, 7)), [3, '50 х 90', 'Цветная', 1.4, 6000, 1500, 2]);
  assert.equal(sheet.data[3][9], 2.8);
  assert.equal(sheet.data[3][13], 'от');
  assert.equal(sheet.data[3][15], 'до');
  assert.deepEqual(['4,8', '4,12', '4,15', '4,17', '4,18'].map(key => sheet.formulas.get(key)), ['=F4*G4', '=D4*3/2', '=F4', '=E4-1', '=D4*27/20']);
  // Пустая строка и примечания сдвинулись вниз, а не затёрлись.
  assert.ok(sheet.data[4].every(value => value === '' || value === undefined));
  assert.equal(sheet.data[5][1], '* - при заказе минимального тиража и больше');
  // Формулы строк выше остались на своих местах.
  assert.equal(sheet.formulas.get('3,8'), '=F3*G3');
});

test('saveCategory: правка строки — вводимые ячейки и H/O; L, Q, R не трогаются; кратность числом', () => {
  const h = loadCodeGs({ sheets: sheets() });
  const reply = call(h, { action: 'saveCategory', row: 3, id: '2', category: category({ price: '1.2', multiple: '3000', reducedFrom: '800' }) });
  assert.equal(reply.ok, true);
  const sheet = h.sheets[CAT];
  assert.equal(sheet.data[2][0], 2);
  assert.equal(sheet.data[2][3], 1.2);
  assert.equal(sheet.data[2][7], 3000);
  assert.equal(sheet.formulas.has('3,8'), false);
  assert.equal(sheet.data[2][14], 800);
  assert.equal(sheet.formulas.get('3,12'), '=D3*1.5');
  // Пустая кратность — снова формула.
  call(h, { action: 'saveCategory', row: 3, id: '2', category: category() });
  assert.equal(sheet.formulas.get('3,8'), '=F3*G3');
  assert.equal(sheet.formulas.get('3,15'), '=F3');
});

test('saveCategory: проверки как у калькулятора и защита от сдвинутой строки', () => {
  const h = loadCodeGs({ sheets: sheets() });
  const error = over => call(h, { action: 'saveCategory', category: category(over) }).error;
  assert.equal(error({ size: '' }).code, 'CATEGORY_INVALID');
  assert.match(error({ price: '0' }).message, /Стоимость/);
  assert.match(error({ price: 'abc' }).message, /Стоимость/);
  assert.match(error({ minimum: '1000,5' }).message, /целое/);
  assert.match(error({ roll: '', multiple: '' }).message, /кратность/i);
  assert.match(error({ roll: '', multiple: '1000' }).message, /Сниженный тираж от/);
  assert.match(error({ reducedFrom: '6000' }).message, /больше, чем «до» \(5999/);
  assert.equal(call(h, { action: 'saveCategory', row: 3, id: '1', category: category() }).error.code, 'CATEGORY_CHANGED');
  assert.equal(call(h, { action: 'saveCategory', row: 5, id: '', category: category() }).error.code, 'CATEGORY_CHANGED');
});

test('deleteCategory: занятую не удаляет и называет артикулы; пустую удаляет со сдвигом строк', () => {
  const h = loadCodeGs({ sheets: sheets() });
  const used = call(h, { action: 'deleteCategory', row: 2, id: '1' }).error;
  assert.equal(used.code, 'CATEGORY_IN_USE');
  assert.match(used.message, /ГФ 10165/);
  assert.equal(call(h, { action: 'deleteCategory', row: 3, id: '1' }).error.code, 'CATEGORY_CHANGED');
  const reply = call(h, { action: 'deleteCategory', row: 3, id: '2' });
  assert.equal(reply.ok, true);
  const sheet = h.sheets[CAT];
  assert.deepEqual(plain(sheet.data.slice(1).map(r => r[0]).filter(v => v !== '' && v !== undefined)), [1]);
  assert.equal(sheet.data[3][1], '* - при заказе минимального тиража и больше');
  assert.equal(sheet.formulas.has('3,8'), false);
  assert.equal(sheet.formulas.get('2,15'), '=F2');
});
