// Администратор: удаление заявок и папки макетов на Яндекс Диске.
// Роль приходит с каждым ответом catalog и orders и нигде не хранится: её решает пароль.
// Клиент с обычным паролем ничего отсюда не видит.
import { state } from './state.js';
import { accessPassword } from './auth.js';
import { apiUrl, failureReason } from './load.js';

// Пока папки собираются, список заявок у администратора обновляется сам.
export const LAYOUTS_REFRESH_MS = 20000;

// «admin» — только при явном payload.role === 'admin'. Любой другой ответ — обычный клиент.
export function roleOf(payload) {
  return payload?.role === 'admin' ? 'admin' : 'client';
}

export const isAdmin = () => state.role === 'admin';

// Первые max проблем через запятую, остальные — «и ещё N».
export function problemsText(problems, max = 5) {
  const items = Array.isArray(problems) ? problems.map(item => String(item ?? '').trim()).filter(Boolean) : [];
  const shown = items.slice(0, max).join(', ');
  const rest = items.length - Math.min(items.length, max);
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

// Что показать про папку макетов. null — показывать нечего (старая заявка или сборка не настроена).
// tone: pending | good | warn | bad.
export function layoutsView(layouts) {
  if (!layouts || typeof layouts !== 'object') return null;
  const url = typeof layouts.url === 'string' ? layouts.url.trim() : '';
  const problems = problemsText(layouts.problems);
  switch (layouts.status) {
    case 'queued':
      return { tone: 'pending', text: 'Макеты в очереди', url, note: '', canRebuild: false };
    case 'building':
      return { tone: 'pending', text: 'Собираем макеты…', url: '', note: '', canRebuild: false };
    case 'done':
      return { tone: 'good', text: 'Папка макетов', url, note: '', canRebuild: true };
    case 'partial':
      return { tone: 'warn', text: 'Папка макетов', url, note: problems ? `Проблемы: ${problems}` : '', canRebuild: true };
    case 'empty':
      return { tone: 'warn', text: 'Макеты не найдены', url: '', note: problems, canRebuild: true };
    case 'failed':
      return { tone: 'bad', text: 'Макеты не собраны', url: '', note: '', canRebuild: true };
    default:
      return null;
  }
}

// Есть ли в списке заявки, чьи макеты ещё в очереди или собираются.
export function hasPendingLayouts(list) {
  return Array.isArray(list) && list.some(entry => ['queued', 'building'].includes(entry?.layouts?.status));
}

// Нужно ли через LAYOUTS_REFRESH_MS снова загрузить список: администратор, открыта вкладка «Заявки»,
// и хотя бы одна папка ещё собирается.
export function needsLayoutsRefresh(role, list, hash) {
  return role === 'admin' && hash === '#orders' && hasPendingLayouts(list);
}

// Как обойтись со списком после ответа на удаление.
// removed — убрать заявку (удалена сейчас или её уже не было); role — пароль больше не админский;
// failed — заявка осталась, кнопку вернуть.
export function deleteOutcome(code) {
  if (!code || code === 'ORDER_NOT_FOUND') return 'removed';
  if (code === 'ADMIN_REQUIRED') return 'role';
  return 'failed';
}

// Текст тоста при ошибке действия администратора. prefix — «Заявка не удалена», «Сборка не запущена».
// ADMIN_REQUIRED, коды *_FAILED и ARTICLE_* сервер уже объясняет целиком («Не удалось удалить заявку: …») — без приставки.
export function adminErrorText(error, prefix) {
  const code = error?.code ?? '';
  if (error?.reason && (code === 'ADMIN_REQUIRED' || code.endsWith('_FAILED') || code.startsWith('ARTICLE_') || code.startsWith('LAYOUT_UPLOAD_') || code.startsWith('CATEGORY_'))) return error.reason;
  return `${prefix}: ${failureReason(error ?? {})}`;
}

// POST к Apps Script с паролем. Ошибка сервера — Error с .code и .reason (текст для человека).
// ADMIN_REQUIRED: пароль больше не админский — роль сразу становится клиентской, выхода нет.
export async function postAction(action, fields = {}, timeoutMs) {
  const controller = new AbortController();
  const limit = Number(timeoutMs) || Number(window.FBPRINT_CONFIG?.requestTimeoutMs) || 10000;
  const timeout = setTimeout(() => controller.abort(), limit);
  try {
    const response = await fetch(apiUrl(), {
      method: 'POST',
      body: JSON.stringify({ action, password: accessPassword(), ...fields }),
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });
    const payload = await response.json();
    const code = payload?.error?.code;
    if (code || !payload?.ok) {
      if (code === 'ADMIN_REQUIRED') state.role = 'client';
      const error = new Error(code || 'NO_ANSWER');
      error.code = code || '';
      error.reason = payload?.error?.message || 'Сервер ответил с ошибкой';
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export const deleteOrderRequest = number => postAction('deleteOrder', { number }, 30000);
export const setOrderStatusRequest = (number, shipped) => postAction('setOrderStatus', { number, shipped });
export const rebuildLayoutsRequest = number => postAction('rebuildLayouts', { number });

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function folderLink(url, text) {
  const link = node('a', 'sent-order-folder', text);
  link.setAttribute('href', url);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  link.dataset.focusKey = 'folder';
  link.append(node('span', 'visually-hidden', ' (откроется в новой вкладке)'));
  return link;
}

function actionButton(className, text, label, focusKey, onClick) {
  const button = node('button', className, text);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.dataset.focusKey = focusKey;
  button.addEventListener('click', () => onClick?.(button));
  return button;
}

// Подпись кнопки пересборки: папка уже есть — «Пересобрать папку», папки нет (ошибка, макетов не нашлось) — «Собрать папку».
export function rebuildLabel(layouts) {
  return layoutsView(layouts)?.url ? 'Пересобрать папку' : 'Собрать папку';
}

// Полоса администратора под заголовком заявки: только папка макетов — состояние, ссылка, пересборка.
// Удаления заявки здесь нет, чтобы его не путали с удалением макетов: оно внизу раскрытой заявки (deleteOrderFooter).
// handlers — { onRebuild(entry, button), busy: '' | 'delete' | 'rebuild' }.
// busy — заявка уже удаляется или пересобирается: кнопка остаётся выключенной после перерисовки.
// Старая заявка или сборка макетов не настроена — null, полосы нет.
export function adminBar(entry, handlers = {}) {
  const view = layoutsView(entry.layouts);
  if (!view) return null;
  const bar = node('div', 'sent-order-admin');
  bar.dataset.tone = view.tone;

  const status = node('p', 'sent-order-layouts');
  status.append(node('span', 'layouts-dot'));
  if (view.url && view.tone !== 'pending') {
    status.append(folderLink(view.url, view.text));
  } else {
    status.append(node('span', 'layouts-text', view.text));
    // После пересборки старая папка остаётся доступной, пока идёт сборка.
    if (view.url) status.append(folderLink(view.url, 'Открыть папку'));
  }
  if (view.note) status.append(node('span', 'layouts-note', view.note));
  bar.append(status);

  if (view.canRebuild) {
    const label = rebuildLabel(entry.layouts);
    const actions = node('div', 'sent-order-actions');
    const rebuild = actionButton('text-button', handlers.busy === 'rebuild' ? 'Запускаем…' : label,
      `${label} макетов заявки ${entry.number}`, 'rebuild', button => handlers.onRebuild?.(entry, button));
    rebuild.disabled = Boolean(handlers.busy);
    actions.append(rebuild);
    bar.append(actions);
  }
  return bar;
}

// Статус заявки у администратора — выпадающий список из двух значений, как в колонке E таблицы.
// handlers — { onChange(entry, shipped), busy: '' | 'delete' | 'rebuild' | 'status' }.
export function statusSelect(entry, handlers = {}) {
  const select = node('select', 'sent-order-status');
  const current = entry.status === 'shipped' ? 'shipped' : 'work';
  [['work', 'В работе'], ['shipped', 'Отгружено']].forEach(([value, label]) => {
    const option = node('option', '', label);
    option.value = value;
    option.selected = value === current;
    select.append(option);
  });
  select.value = current;
  select.dataset.cell = current;
  select.dataset.focusKey = 'status';
  select.setAttribute('aria-label', `Статус заявки ${entry.number}`);
  select.disabled = Boolean(handlers.busy);
  select.addEventListener('change', () => handlers.onChange?.(entry, select.value === 'shipped'));
  return select;
}

// Корзина в строке заголовка заявки у администратора: удалить заявку можно, не раскрывая её.
// Стоит рядом с номером и суммой, а не в строке папки — так ясно, что удаляется заявка, а не макеты.
// handlers — { onDelete(entry, button), busy: '' | 'delete' | 'rebuild' }.
export function deleteOrderButton(entry, handlers = {}) {
  const deleting = handlers.busy === 'delete';
  const button = actionButton('sent-order-delete', '', deleting ? `Удаляем заявку ${entry.number}` : `Удалить заявку ${entry.number}`,
    'delete', target => handlers.onDelete?.(entry, target));
  button.title = deleting ? 'Удаляем…' : 'Удалить заявку';
  button.innerHTML = TRASH_ICON;
  button.disabled = Boolean(handlers.busy);
  return button;
}

export const TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
