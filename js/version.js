// Узнаёт, что сайт обновился, пока вкладка была открыта.
// Открытая вкладка работает на том коде, с которым загрузилась, хоть неделю. Поэтому перед отправкой
// заявки и при возвращении на вкладку сайт сверяет свою версию (meta app-version, её ставит
// tools/stamp-version.mjs) со свежим index.html. Версия другая — страницу нужно перезагрузить.
// Заявка при перезагрузке не теряется: она хранится в браузере.
import { toast } from './toast.js';

const UPDATED_KEY = 'fbprint-updated';
const CHECK_TIMEOUT_MS = 5000;
// Реже раза в 10 минут при возвращении на вкладку не проверяем.
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

export const versionFromHtml = html => (String(html).match(/<meta name="app-version" content="([^"]*)">/) || [])[1] || '';

export const currentVersion = () => document.querySelector?.('meta[name="app-version"]')?.content || '';

// Версия опубликованного сайта или '' — если узнать не удалось (нет связи, локальный запуск без версии).
export async function latestVersion(fetcher = globalThis.fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const url = new URL('index.html', location.href);
    url.searchParams.set('check', Date.now());
    const response = await fetcher(url, { cache: 'no-store', signal: controller.signal });
    return response.ok ? versionFromHtml(await response.text()) : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

// Устарела ли эта вкладка. Не удалось проверить — считаем, что нет: проверка не должна мешать работе.
export async function siteOutdated(fetcher) {
  const current = currentVersion();
  if (!current) return false;
  const latest = await latestVersion(fetcher);
  return Boolean(latest) && latest !== current;
}

// Перезагрузить страницу; после загрузки показать message.
export function reloadForUpdate(message) {
  try {
    sessionStorage.setItem(UPDATED_KEY, message);
  } catch {
    // Без хранилища страница просто перезагрузится без сообщения.
  }
  location.reload();
}

function showUpdatedMessage() {
  let message = '';
  try {
    message = sessionStorage.getItem(UPDATED_KEY) || '';
    sessionStorage.removeItem(UPDATED_KEY);
  } catch {
    message = '';
  }
  if (message) toast(message, { persist: true });
}

let lastCheck = Date.now();
let offered = false;

async function checkOnReturn() {
  if (document.visibilityState !== 'visible' || offered || Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
  lastCheck = Date.now();
  if (!(await siteOutdated())) return;
  offered = true;
  toast('Сайт обновился. Обновите страницу — заявка сохранится.', {
    action: 'Обновить',
    onAction: () => location.reload()
  });
}

export function initVersionCheck() {
  showUpdatedMessage();
  document.addEventListener('visibilitychange', checkOnReturn);
}
