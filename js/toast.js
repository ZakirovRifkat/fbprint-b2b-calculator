// Уведомление внизу экрана.
import { $ } from './format.js';

// Обычный тост висит 5 секунд и замирает под курсором и фокусом.
// Тост с ошибкой или кнопкой остаётся, пока его не закроют.
export function toast(message, { action = '', onAction = null, persist = false } = {}) {
  const element = $('#toast');
  const sticky = persist || Boolean(action);
  $('#toast-text').textContent = message;
  $('#toast-action').textContent = action;
  $('#toast-action').hidden = !action;
  $('#toast-close').hidden = !sticky;
  toast.onAction = onAction;
  element.dataset.sticky = String(sticky);
  element.hidden = false;
  restartToastTimer();
}

export function restartToastTimer() {
  clearTimeout(toast.timer);
  if ($('#toast').hidden || $('#toast').dataset.sticky === 'true') return;
  toast.timer = setTimeout(hideToast, 5000);
}

export function hideToast() {
  clearTimeout(toast.timer);
  $('#toast').hidden = true;
}
