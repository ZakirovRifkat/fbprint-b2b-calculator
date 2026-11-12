// Подтверждение перед удалением. Возвращает true, только если нажали кнопку действия:
// «Отмена», Esc и клик по подложке ничего не удаляют. Фокус по умолчанию — на «Отмена».
// Ответ берём из нажатия, а не из события close: его браузер может прислать с задержкой.
import { $ } from './format.js';

let answer = null;

function finish(confirmed) {
  const dialog = $('#confirm-dialog');
  if (dialog.open) dialog.close();
  const resolve = answer;
  answer = null;
  resolve?.(confirmed);
}

export function confirmAction({ title, message = '', confirmLabel }) {
  finish(false);
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-message').hidden = !message;
  $('#confirm-ok').textContent = confirmLabel;
  $('#confirm-dialog').showModal();
  return new Promise(resolve => {
    answer = resolve;
  });
}

export function initConfirm() {
  const dialog = $('#confirm-dialog');
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    finish(event.submitter?.value === 'confirm');
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    finish(false);
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) finish(false);
  });
}
