import { test } from 'node:test';
import assert from 'node:assert/strict';
// state.js — первым, как в main.js: catalog.js и state.js импортируют друг друга.
import { state } from '../js/state.js';
import { categories, normalizeCatalog, number, price, text } from '../js/catalog.js';
import { rawCatalog } from './helpers.js';

test('демо-каталог проходит проверку', () => {
  const data = normalizeCatalog(rawCatalog());
  assert.equal(data.companies.length, 2);
  assert.equal(data.categories.length, 3);
  assert.equal(data.articles.length, 5);
  assert.equal(data.version, 'demo');
  assert.deepEqual(data.categories[0].reducedRun, { minQuantity: 1000, maxQuantity: 3999, price: 1.4 });
  assert.equal(data.categories[2].reducedRun, null);
});

test('text обрезает пробелы и не пропускает пустое', () => {
  assert.equal(text('  А  ', 'поле'), 'А');
  assert.throws(() => text('   ', 'Компания №1: id'), /Компания №1: id — не заполнено/);
  assert.throws(() => text(null, 'поле'), /не заполнено/);
});

test('number понимает числа, как их пишут в таблице', () => {
  assert.equal(number(4000, 'п'), 4000);
  assert.equal(number('4 000', 'п'), 4000);
  assert.equal(number('1,5', 'п'), 1.5);
  assert.equal(number('1 234,5', 'п'), 1234.5);
  assert.equal(number('1.234,56', 'п'), 1234.56);
  assert.equal(number('1,234.56', 'п'), 1234.56);
  assert.equal(number('12 руб.', 'п'), 12);
});

test('number не пропускает ноль, минус, текст и дробь там, где нужно целое', () => {
  assert.throws(() => number(0, 'п'), /больше нуля/);
  assert.throws(() => number('-5', 'п'), /больше нуля/);
  assert.throws(() => number('много', 'п'), /больше нуля/);
  assert.throws(() => number(1.5, 'Тираж', { integerOnly: true }), /Тираж — нужно целое число/);
});

test('number с optional пропускает пустое как null', () => {
  assert.equal(number('', 'п', { optional: true }), null);
  assert.equal(number(undefined, 'п', { optional: true }), null);
  assert.throws(() => number('', 'п'));
});

test('price округляет до копейки', () => {
  assert.equal(price('1,125', 'п'), 1.13);
  assert.throws(() => price('0,001', 'Стоимость'), /Стоимость — нужно число больше нуля/);
});

test('размер этикетки пишется через «×»', () => {
  const raw = rawCatalog();
  raw.categories[0].size = '80x120 мм';
  raw.categories[1].size = '60Х100';
  raw.categories[2].size = '58*40';
  const sizes = normalizeCatalog(raw).categories.map(item => item.size);
  assert.deepEqual(sizes, ['80 × 120 мм', '60 × 100', '58 × 40']);
});

test('артикул без категории скрывается, а не считается ошибкой', () => {
  const raw = rawCatalog();
  raw.articles.push({ companyId: 'demo_a', sku: '1999', categoryId: '', name: 'Новинка' });
  assert.equal(normalizeCatalog(raw).articles.length, 5);
});

test('ошибка от Apps Script показывается как есть', () => {
  assert.throws(() => normalizeCatalog({ error: { message: 'ACCESS_DENIED' } }), /ACCESS_DENIED/);
  assert.throws(() => normalizeCatalog({ error: 'сломалось' }), /сломалось/);
});

test('каталог в чужом формате не принимается', () => {
  assert.throws(() => normalizeCatalog(null), /неверном формате/);
  assert.throws(() => normalizeCatalog([]), /неверном формате/);
  assert.throws(() => normalizeCatalog({ companies: [] }), /нет списков/);
  assert.throws(() => normalizeCatalog({ ...rawCatalog(), schemaVersion: 2 }), /версию каталога 2/);
  assert.throws(() => normalizeCatalog({ ...rawCatalog(), companies: [] }), /нет компаний или категорий/);
});

test('повторы в каталоге ловятся', () => {
  const companies = rawCatalog();
  companies.companies.push({ id: 'demo_a', name: 'Ещё одна' });
  assert.throws(() => normalizeCatalog(companies), /Компания demo_a встречается дважды/);

  const articles = rawCatalog();
  articles.articles.push({ companyId: 'demo_a', sku: '1001', categoryId: '2', name: 'Повтор' });
  assert.throws(() => normalizeCatalog(articles), /Артикул 1001 \(Демо-компания А\) встречается дважды/);
});

test('ссылки на неизвестную компанию или категорию ловятся', () => {
  const company = rawCatalog();
  company.articles.push({ companyId: 'nobody', sku: '5', categoryId: '1', name: 'X' });
  assert.throws(() => normalizeCatalog(company), /неизвестная компания nobody/);

  const category = rawCatalog();
  category.articles.push({ companyId: 'demo_a', sku: '5', categoryId: '42', name: 'X' });
  assert.throws(() => normalizeCatalog(category), /категории 42 нет на листе/);
});

test('ошибка в категории называет лист, категорию и столбец', () => {
  const raw = rawCatalog();
  raw.categories[1].prices.urgent = '';
  assert.throws(() => normalizeCatalog(raw), /Лист «Категории», категория 2: «Срочный заказ»/);
});

test('сниженный тираж «от» больше «до» не принимается', () => {
  const raw = rawCatalog();
  raw.categories[0].reducedRun = { minQuantity: 3000, maxQuantity: 2000, price: 1.4 };
  assert.throws(() => normalizeCatalog(raw), /«от» больше, чем «до»/);
});

test('categories() ищет категорию по id в текущем каталоге', () => {
  state.data = normalizeCatalog(rawCatalog());
  assert.equal(categories().get('3').size, 'D80');
  assert.equal(categories().get('42'), undefined);
});
