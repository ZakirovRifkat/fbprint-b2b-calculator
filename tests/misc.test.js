// Небольшие правила из модулей, где остальное — работа со страницей.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inOrder, lineKey, matchingArticles, searchKey } from '../js/calculator.js';
import { apiUrl, failureReason } from '../js/load.js';
import { orderStatus } from '../js/orders.js';
import { state } from '../js/state.js';
import { useDemoCatalog } from './helpers.js';

test('searchKey не различает регистр и «ё»', () => {
  assert.equal(searchKey('КОПЧЁНОСТИ'), 'копчености');
});

test('matchingArticles ищет только у выбранной компании, по коду и названию', () => {
  useDemoCatalog('demo_a');
  assert.deepEqual(matchingArticles('').map(item => item.sku), ['1001', '1002', '1003']);
  assert.deepEqual(matchingArticles('  суп ').map(item => item.sku), ['1002']);
  assert.deepEqual(matchingArticles('100').map(item => item.sku), ['1001', '1002', '1003']);
  assert.deepEqual(matchingArticles('2001'), []);
  state.companyId = 'demo_b';
  assert.deepEqual(matchingArticles('2001').map(item => item.sku), ['2001']);
});

test('lineKey и inOrder: один артикул компании — одна позиция', () => {
  useDemoCatalog('demo_a');
  const item = { companyId: 'demo_a', sku: '1001' };
  assert.equal(lineKey(item), 'demo_a/1001');
  assert.equal(inOrder(item), false);
  state.order = [{ key: 'demo_a/1001' }];
  assert.equal(inOrder(item), true);
  assert.equal(inOrder({ companyId: 'demo_b', sku: '1001' }), false);
});

test('failureReason объясняет ошибку загрузки простыми словами', () => {
  assert.equal(failureReason({ reason: 'Ошибка в таблице' }), 'Ошибка в таблице');
  assert.equal(failureReason({ name: 'AbortError' }), 'Сервер не ответил вовремя');
  assert.equal(failureReason({ name: 'TypeError' }), 'Нет связи с сервером');
  assert.equal(failureReason(new Error('500')), 'Сервер ответил с ошибкой');
});

test('apiUrl берётся из config.js, пустой адрес — демо-режим', () => {
  globalThis.window = {};
  assert.equal(apiUrl(), '');
  globalThis.window = { FBPRINT_CONFIG: { apiUrl: ' https://script.example/exec ' } };
  assert.equal(apiUrl(), 'https://script.example/exec');
});

test('orderStatus: «Отгружено» только по пометке менеджера', () => {
  assert.equal(orderStatus({ status: 'shipped' }), 'shipped');
  assert.equal(orderStatus({ status: '' }), 'work');
  assert.equal(orderStatus({}), 'work');
});
