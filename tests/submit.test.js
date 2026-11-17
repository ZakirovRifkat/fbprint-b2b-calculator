// js/submit.js: метка попытки отправки — одна на одни и те же позиции, пока заявка не принята.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokenStorage, installDom, memoryStorage } from './helpers.js';

installDom();
const { forgetOrderRequest, orderRequestId, orderRequestKey } = await import('../js/submit.js');

const lines = [{ company: 'Глобал Фуд', sku: '10165', quantity: 4000, total: 4520 }];

test('те же позиции — та же метка, и после перезагрузки страницы', () => {
  const storage = memoryStorage();
  const id = orderRequestId(lines, storage);
  assert.match(id, /^[A-Za-z0-9-]{8,64}$/);
  assert.equal(orderRequestId(structuredClone(lines), storage), id);
  assert.equal(JSON.parse(storage.getItem(orderRequestKey)).id, id);
  forgetOrderRequest(storage);
});

test('позиции поменялись — новая метка; после принятой заявки — новая метка', () => {
  const storage = memoryStorage();
  const id = orderRequestId(lines, storage);
  const changed = orderRequestId([{ ...lines[0], quantity: 8000 }], storage);
  assert.notEqual(changed, id);
  forgetOrderRequest(storage);
  assert.equal(storage.getItem(orderRequestKey), null);
  assert.notEqual(orderRequestId([{ ...lines[0], quantity: 8000 }], storage), changed);
  forgetOrderRequest(storage);
});

test('хранилище недоступно — метка держится в памяти вкладки', () => {
  const storage = brokenStorage();
  const id = orderRequestId(lines, storage);
  assert.equal(orderRequestId(lines, storage), id);
  forgetOrderRequest(storage);
  assert.notEqual(orderRequestId(lines, storage), id);
});
