import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createId, integer, money, plural, roundMoney } from '../js/format.js';
import { plain } from './helpers.js';

test('roundMoney округляет до копейки, как таблица', () => {
  assert.equal(roundMoney(0.75 * 1.5), 1.13);
  assert.equal(roundMoney(1.425), 1.43);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(4000), 4000);
});

test('plural выбирает форму слова по числу', () => {
  const word = value => plural(value, 'позиция', 'позиции', 'позиций');
  assert.equal(word(1), 'позиция');
  assert.equal(word(21), 'позиция');
  assert.equal(word(2), 'позиции');
  assert.equal(word(34), 'позиции');
  assert.equal(word(0), 'позиций');
  assert.equal(word(5), 'позиций');
  assert.equal(word(11), 'позиций');
  assert.equal(word(12), 'позиций');
  assert.equal(word(14), 'позиций');
  assert.equal(word(111), 'позиций');
});

test('createId даёт разные строки', () => {
  const ids = new Set(Array.from({ length: 50 }, createId));
  assert.equal(ids.size, 50);
});

test('числа и деньги — по-русски', () => {
  assert.equal(plain(integer.format(100000)), '100 000');
  assert.equal(plain(money.format(1.4)), '1,40 ₽');
  assert.equal(plain(money.format(0.125)), '0,125 ₽');
});
