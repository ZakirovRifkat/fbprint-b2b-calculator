import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { accessPassword, forgetPassword, passwordKey, readStorage, rememberPassword, writeStorage } from '../js/auth.js';
import { state } from '../js/state.js';
import { brokenStorage, memoryStorage, setStorage } from './helpers.js';

let local;
let session;

beforeEach(() => {
  local = memoryStorage();
  session = memoryStorage();
  setStorage('localStorage', local);
  setStorage('sessionStorage', session);
  state.sessionPassword = '';
});

test('readStorage и writeStorage хранят пароль под одним ключом', () => {
  writeStorage(local, 'секрет');
  assert.equal(local.getItem(passwordKey), 'секрет');
  assert.equal(readStorage(local), 'секрет');
  writeStorage(local, '');
  assert.equal(readStorage(local), '');
});

test('недоступное хранилище не ломает вход', () => {
  assert.equal(readStorage(brokenStorage()), '');
  assert.doesNotThrow(() => writeStorage(brokenStorage(), 'секрет'));
});

test('«Сохранить пароль» кладёт пароль в localStorage', () => {
  session.setItem(passwordKey, 'старый');
  rememberPassword('секрет', true);
  assert.equal(local.getItem(passwordKey), 'секрет');
  assert.equal(session.getItem(passwordKey), null);
});

test('без галочки пароль живёт только во вкладке', () => {
  local.setItem(passwordKey, 'старый');
  rememberPassword('секрет', false);
  assert.equal(local.getItem(passwordKey), null);
  assert.equal(session.getItem(passwordKey), 'секрет');
});

test('accessPassword берёт пароль из памяти, потом из localStorage, потом из вкладки', () => {
  session.setItem(passwordKey, 'из вкладки');
  assert.equal(accessPassword(), 'из вкладки');

  state.sessionPassword = '';
  local.setItem(passwordKey, 'сохранённый');
  assert.equal(accessPassword(), 'сохранённый');

  state.sessionPassword = 'в памяти';
  assert.equal(accessPassword(), 'в памяти');
});

test('forgetPassword стирает пароль отовсюду', () => {
  rememberPassword('секрет', true);
  forgetPassword();
  assert.equal(state.sessionPassword, '');
  assert.equal(accessPassword(), '');
});
