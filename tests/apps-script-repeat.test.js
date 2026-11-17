// Двойная отправка: та же заявка с тем же requestId второй раз не создаётся.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GF, TEST_PASSWORDS, loadCodeGs } from './gas-harness.js';

const CLIENT = TEST_PASSWORDS.client;
const LINES = [[GF, '10165']];
const sentToManager = h => h.telegram.filter(m => m.method === 'sendMessage' && /^Новая заявка/.test(m.text || '')).length;

test('повтор с тем же requestId: тот же номер, одна строка, одно сообщение', () => {
  const h = loadCodeGs();
  const first = h.order(LINES, CLIENT, { requestId: 'a1b2c3d4-0001' });
  const again = h.order(LINES, CLIENT, { requestId: 'a1b2c3d4-0001' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(again, { ok: true, number: first.number, repeated: true });
  assert.equal(h.orderRows().length, 1);
  assert.equal(sentToManager(h), 1);
});

test('другой requestId или без него — новая заявка', () => {
  const h = loadCodeGs();
  const first = h.order(LINES, CLIENT, { requestId: 'a1b2c3d4-0001' });
  const other = h.order(LINES, CLIENT, { requestId: 'a1b2c3d4-0002' });
  const plain = h.order(LINES, CLIENT);
  assert.notEqual(first.number, other.number);
  assert.notEqual(other.number, plain.number);
  assert.equal(h.orderRows().length, 3);
});

test('requestId неверного вида не учитывается', () => {
  const h = loadCodeGs();
  h.order(LINES, CLIENT, { requestId: 'плохая метка' });
  h.order(LINES, CLIENT, { requestId: 'плохая метка' });
  assert.equal(h.orderRows().length, 2);
});

test('заявка ещё отправляется — повтор получает ORDER_IN_PROGRESS', () => {
  const h = loadCodeGs();
  h.cache.set('order-request:a1b2c3d4-0001', JSON.stringify({ number: 'FB-0001 от 01.01.2026', sent: false }));
  const reply = h.order(LINES, CLIENT, { requestId: 'a1b2c3d4-0001' });
  assert.equal(reply.error.code, 'ORDER_IN_PROGRESS');
  assert.match(reply.error.message, /FB-0001/);
  assert.equal(h.orderRows().length, 0);
});

test('Telegram не принял — метка забыта, повтор отправляет заявку заново', () => {
  const h = loadCodeGs();
  h.telegramState.status = 500;
  const failed = h.order(LINES, CLIENT, { requestId: 'a1b2c3d4-0001' });
  assert.equal(failed.error.code, 'ORDER_SEND_FAILED');
  assert.equal(h.orderRows().length, 0);
  h.telegramState.status = 200;
  const retry = h.order(LINES, CLIENT, { requestId: 'a1b2c3d4-0001' });
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.repeated, undefined);
  assert.equal(h.orderRows().length, 1);
});
