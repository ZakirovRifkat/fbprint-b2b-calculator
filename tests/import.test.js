import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellValue, companyByName, evaluateImportRow, fixable, guessLayout, looseText,
  parseImportRows, prepareImport, quantityValue, skuText, urgencyValue
} from '../js/import.js';
import { state } from '../js/state.js';
import { plain, useDemoCatalog } from './helpers.js';

beforeEach(() => useDemoCatalog('demo_a'));

const item = (sku, quantity, extra = {}) => ({ companyId: null, sku, quantity, urgency: 'standard', source: `строка ${sku}`, ...extra });

test('cellValue достаёт значение из формул, форматированного текста и ссылок', () => {
  assert.equal(cellValue(null), '');
  assert.equal(cellValue(undefined), '');
  assert.equal(cellValue(new Date()), '');
  assert.equal(cellValue({ formula: 'A1*2', result: 4000 }), 4000);
  assert.equal(cellValue({ richText: [{ text: '10' }, { text: '01' }] }), '1001');
  assert.equal(cellValue({ text: 'Салат', hyperlink: 'https://example.com' }), 'Салат');
  assert.equal(cellValue({}), '');
  assert.equal(cellValue('1001'), '1001');
});

test('skuText убирает пробелы и «.0» от чисел Excel', () => {
  assert.equal(skuText(1001), '1001');
  assert.equal(skuText(' 1001.0 '), '1001');
  assert.equal(skuText(null), '');
});

test('quantityValue читает тираж с пробелами и запятой', () => {
  assert.equal(quantityValue(4000), 4000);
  assert.equal(quantityValue('4 000'), 4000);
  assert.equal(quantityValue('4 000'), 4000);
  assert.equal(quantityValue('3999,6'), 4000);
  assert.equal(quantityValue(-3), 0);
  assert.equal(quantityValue('много'), 0);
  assert.equal(quantityValue(''), 0);
});

test('urgencyValue понимает срочность словами', () => {
  assert.equal(urgencyValue('Срочный'), 'urgent');
  assert.equal(urgencyValue('ЭКСТРЕННО'), 'emergency');
  assert.equal(urgencyValue('обычный'), 'standard');
  assert.equal(urgencyValue(''), 'standard');
});

test('looseText сравнивает без регистра, «ё» и знаков', () => {
  assert.equal(looseText('Ёлка-1 «Б»'), 'елка1б');
});

test('companyByName находит компанию по названию без учёта написания', () => {
  assert.equal(companyByName('демо компания а').id, 'demo_a');
  assert.equal(companyByName('ДЕМО-КОМПАНИЯ Б').id, 'demo_b');
  assert.equal(companyByName('Другая'), null);
  assert.equal(companyByName(''), null);
});

test('guessLayout без заголовков: код — первый столбец, тираж — первое число после него', () => {
  assert.deepEqual(guessLayout(['', '1001', 'Салат', 4000, 'срочно']), { sku: 1, quantity: 3, urgency: 4, companyId: null });
  assert.equal(guessLayout(['Итого']), null);
  assert.equal(guessLayout([]), null);
});

test('parseImportRows читает таблицу с заголовком и компанией в заголовке', () => {
  const rows = [
    ['Заявка на март'],
    ['Код', 'Демо-компания Б', 'Тираж, шт', 'Цена', 'Срок'],
    ['2001', 'Сэндвич', 4000, 1, 'срочный'],
    ['Итого', '', 4000, '', ''],
    [],
    [{ result: '2002' }, 'Каша', ' 6 000', '', '']
  ];
  assert.deepEqual(parseImportRows(rows, 'файл, ', 'demo_a'), [
    { companyId: 'demo_b', sku: '2001', quantity: 4000, urgency: 'urgent', source: 'файл, строка 3' },
    { companyId: 'demo_b', sku: '2002', quantity: 6000, urgency: 'standard', source: 'файл, строка 6' }
  ]);
});

test('parseImportRows без заголовков берёт компанию, выбранную на сайте', () => {
  const rows = [['1001', 4000], ['1002', 'много'], ['1003', 5000, 'экстренный']];
  assert.deepEqual(parseImportRows(rows, '', 'demo_a'), [
    { companyId: 'demo_a', sku: '1001', quantity: 4000, urgency: 'standard', source: 'строка 1' },
    { companyId: 'demo_a', sku: '1003', quantity: 5000, urgency: 'emergency', source: 'строка 3' }
  ]);
});

test('parseImportRows не берёт столбец цены за тираж', () => {
  const rows = [['Артикул', 'Цена за шт', 'Количество'], ['1001', 1.5, 4000]];
  assert.equal(parseImportRows(rows, '')[0].quantity, 4000);
});

test('parseImportRows пропускает таблицу без столбца тиража', () => {
  assert.deepEqual(parseImportRows([['Код', 'Название'], ['1001', 'Салат']], ''), []);
});

test('prepareImport находит артикулы, компанию по артикулу и повторы', () => {
  prepareImport([item('1001', 4000), item('2001', 4000), item('1001', 2000), item('9999', 4000)]);
  const [first, other, repeat, missing] = state.importRows;
  assert.equal(first.article.name, 'Демо-этикетка «Салат»');
  assert.equal(other.companyId, 'demo_b');
  assert.equal(other.note, 'Компания определена по артикулу');
  assert.equal(repeat.duplicateOf, first);
  assert.equal(missing.article, null);
});

test('prepareImport не ищет артикул у другой компании, если компания задана в файле', () => {
  prepareImport([item('2001', 4000, { companyId: 'demo_a' })]);
  assert.equal(state.importRows[0].article, null);
});

test('evaluateImportRow: подходит, повтор, нет в каталоге, уже в заявке', () => {
  prepareImport([item('1001', 4000, { urgency: 'urgent' }), item('1001', 8000), item('9999', 4000), item('1002', 6000)]);
  state.order = [{ key: 'demo_a/1002' }];
  const [good, repeat, missing, inOrder] = state.importRows.map(evaluateImportRow);
  assert.equal(good.kind, 'good');
  assert.equal(good.unitPrice, 1.5);
  assert.equal(good.urgencyDropped, false);
  assert.equal(repeat.kind, 'duplicate');
  assert.match(repeat.message, /строка 1001/);
  assert.equal(missing.kind, 'missing');
  assert.equal(inOrder.kind, 'inOrder');
  assert.ok([repeat, missing, inOrder].every(result => !result.canAdd));
});

test('evaluateImportRow: сниженный тираж сбрасывает срочность', () => {
  prepareImport([item('1002', 3000, { urgency: 'urgent' })]);
  const result = evaluateImportRow(state.importRows[0]);
  assert.equal(result.kind, 'reduced');
  assert.equal(result.urgency, 'standard');
  assert.equal(result.urgencyDropped, true);
  assert.equal(plain(result.message), 'От 6 000 шт. — 0,50 ₽ за штуку.');
  assert.equal(fixable(result), false);
});

test('evaluateImportRow: некратный и слишком малый тираж можно исправить', () => {
  prepareImport([item('1003', 7000), item('1001', 500)]);
  const [multiple, blocked] = state.importRows.map(evaluateImportRow);
  assert.equal(multiple.kind, 'multiple');
  assert.equal(multiple.suggested, 7500);
  assert.equal(plain(multiple.message), 'Кратность 2 500 шт.');
  assert.equal(fixable(multiple), true);
  assert.equal(blocked.kind, 'blocked');
  assert.equal(blocked.suggested, 1000);
  assert.equal(fixable(blocked), true);
});

test('fixable без подсказки — false', () => {
  assert.equal(fixable({ kind: 'multiple', suggested: null }), false);
  assert.equal(fixable({ kind: 'good', suggested: null }), false);
});
