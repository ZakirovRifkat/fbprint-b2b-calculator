// Вход по паролю: хранение пароля, окно входа, экран загрузки.
import { state } from './state.js';
import { $ } from './format.js';
import { setDataStatus, showCatalogError } from './load.js';

// Пароль выдаёт менеджер FB Print. Проверяет его Apps Script (свойство ACCESS_PASSWORD).
// С галочкой «Сохранить пароль» он лежит в localStorage и переживает закрытие браузера,
// без неё — в sessionStorage: переживает перезагрузку, но забывается вместе с вкладкой.
export const passwordKey = 'fbprint-access-password';
export const accessErrors = ['ACCESS_DENIED', 'ACCESS_NOT_CONFIGURED'];

export function readStorage(storage) {
  try {
    return storage.getItem(passwordKey) ?? '';
  } catch {
    return '';
  }
}

export function writeStorage(storage, value) {
  try {
    if (value) storage.setItem(passwordKey, value);
    else storage.removeItem(passwordKey);
  } catch {
    // Хранилище недоступно (приватный режим) — пароль живёт до перезагрузки страницы.
  }
}

export function accessPassword() {
  state.sessionPassword ||= readStorage(localStorage) || readStorage(sessionStorage);
  return state.sessionPassword;
}

export function rememberPassword(value, persist) {
  state.sessionPassword = value;
  writeStorage(localStorage, persist ? value : '');
  writeStorage(sessionStorage, persist ? '' : value);
}

export function forgetPassword() {
  state.sessionPassword = '';
  writeStorage(localStorage, '');
  writeStorage(sessionStorage, '');
}

export function showPassword(visible) {
  $('#login-password').type = visible ? 'text' : 'password';
  $('#toggle-password').ariaPressed = String(visible);
  $('#toggle-password').ariaLabel = visible ? 'Скрыть пароль' : 'Показать пароль';
}

// Пока пароль проверяется, окно входа остаётся открытым, а кнопка «Войти» крутит загрузку.
export function setLoginBusy(busy) {
  $('#login-submit').disabled = busy;
  $('#login-submit').ariaBusy = String(busy);
  $('#login-password').readOnly = busy;
}

// Экран «Загружаем каталог» — только при входе по сохранённому паролю.
// Пароль, введённый вручную, проверяется с загрузкой на кнопке «Войти».
export function showPageLoader(visible) {
  $('#page-loader').hidden = !visible;
}

// При ошибке введённый пароль остаётся в поле выделенным — опечатку легко поправить.
// Если не подошёл сохранённый пароль, экран загрузки сменяется окном входа с ошибкой.
export function askPassword(message = '') {
  showPageLoader(false);
  setLoginBusy(false);
  setDataStatus('locked', 'Нужен пароль');
  showCatalogError('');
  $('#login-error').textContent = message;
  $('#login-error').hidden = !message;
  if (!$('#login-dialog').open) {
    $('#login-password').value = '';
    showPassword(false);
    $('#login-dialog').showModal();
  }
  $('#login-password').focus();
  $('#login-password').select();
}

export function closeLogin() {
  setLoginBusy(false);
  if ($('#login-dialog').open) $('#login-dialog').close();
}
