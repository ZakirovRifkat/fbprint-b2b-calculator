// Вкладка «Артикулы» у администратора: каждый артикул обеих компаний с его макетом на Яндекс Диске.
// Только просмотр. Ссылка открывает файл в Диске у того, кто вошёл в этот аккаунт Яндекса.
// Превью скачивает Apps Script с токеном и отдаёт картинкой: файлы на Диске не публикуются.
import { state } from './state.js';
import { $, plural } from './format.js';
import { adminErrorText, isAdmin, postAction } from './admin.js';

// Превью за один запрос к Apps Script и сколько таких запросов идёт одновременно.
export const PREVIEW_BATCH = 12;
export const PREVIEW_PARALLEL = 2;

const ALL = 'all';

// Ключ поиска: нижний регистр, «ё» → «е».
const searchKey = value => String(value ?? '').toLowerCase().replace(/ё/g, 'е').trim();

// Что не так с макетом артикула. Пустая строка — макет есть.
export function problemText(article) {
  const candidates = Array.isArray(article?.candidates) ? article.candidates : [];
  switch (article?.problem) {
    case 'missing':
      return 'На Диске нет файла с этим артикулом';
    case 'conflict':
      return `На Диске несколько файлов: ${candidates.join(', ')}. Впишите нужный в колонку «Макет»`;
    case 'notFound':
      return `В колонке «Макет» указан «${candidates[0] ?? ''}», но такого файла на Диске нет`;
    default:
      return '';
  }
}

export const hasLayout = article => Boolean(article?.path) && !article?.problem;

// Артикулы под фильтры: компания, только без макета, поиск по артикулу, названию и имени файла.
export function filterArticles(list, { company = ALL, missing = false, query = '' } = {}) {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  return (Array.isArray(list) ? list : []).filter(article => {
    if (company !== ALL && article.companyId !== company) return false;
    if (missing && hasLayout(article)) return false;
    if (!words.length) return true;
    const haystack = searchKey(`${article.sku} ${article.name} ${article.layout}`);
    return words.every(word => haystack.includes(word));
  });
}

// Числа на кнопках: артикулов у каждой компании и без макета в выбранной компании.
export function articleCounts(list, company = ALL) {
  const items = Array.isArray(list) ? list : [];
  const byCompany = { [ALL]: items.length };
  items.forEach(article => { byCompany[article.companyId] = (byCompany[article.companyId] ?? 0) + 1; });
  const scope = company === ALL ? items : items.filter(article => article.companyId === company);
  return { byCompany, missing: scope.filter(article => !hasLayout(article)).length };
}

export const articleLayoutsRequest = () => postAction('articleLayouts', {}, 60000);
export const layoutPreviewsRequest = paths => postAction('layoutPreviews', { paths }, 60000);

// ───── Загрузка списка ─────

const view = {
  list: [],
  companies: [],
  loaded: false,
  loading: null,
  error: '',
  filter: { company: ALL, missing: false, query: '' }
};

// Загружает список, если вкладка открыта у администратора. force — заново, даже если уже загружен.
export async function loadArticles({ force = false } = {}) {
  if (!isAdmin() || location.hash !== '#articles') return;
  if (view.loading) return view.loading;
  if (view.loaded && !force) {
    renderArticles();
    return;
  }
  view.error = '';
  renderArticles();
  view.loading = (async () => {
    try {
      const payload = await articleLayoutsRequest();
      view.list = Array.isArray(payload.articles) ? payload.articles : [];
      view.companies = Array.isArray(payload.companies) ? payload.companies : [];
      view.files = Number(payload.files) || 0;
      view.loaded = true;
      view.loadedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      // Превью могли поменяться на Диске — после обновления списка запрашиваем их заново.
      if (force) previews.clear();
    } catch (error) {
      console.warn('Артикулы не загружены:', error);
      view.error = adminErrorText(error, 'Артикулы не загрузились');
    } finally {
      view.loading = null;
      renderArticles();
    }
  })();
  return view.loading;
}

// ───── Отрисовка ─────

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null && text !== '') element.textContent = text;
  return element;
}

function companyName(id) {
  return view.companies.find(company => company.id === id)?.name ?? id;
}

function renderToolbar(counts) {
  const group = $('#articles-company');
  const options = [{ id: ALL, name: 'Все' }, ...view.companies];
  group.replaceChildren(...options.map(option => {
    const button = node('button');
    button.type = 'button';
    button.dataset.company = option.id;
    button.setAttribute('aria-pressed', String(view.filter.company === option.id));
    button.append(option.name, node('span', '', String(counts.byCompany[option.id] ?? 0)));
    return button;
  }));
  const missing = $('#articles-missing');
  missing.setAttribute('aria-pressed', String(view.filter.missing));
  $('#articles-missing-count').textContent = counts.missing;
}

function syncText() {
  if (view.loading) return 'Загружаем артикулы и макеты с Яндекс Диска…';
  if (!view.loaded) return '';
  return `Файлов в папке макетов: ${view.files}. Обновлено в ${view.loadedAt}`;
}

export function renderArticles() {
  const root = $('#article-cards');
  if (!root) return;
  $('#articles-sync').textContent = syncText();
  $('#articles-view').ariaBusy = String(Boolean(view.loading));
  $('#articles-toolbar').hidden = !view.loaded;

  const error = $('#articles-error');
  error.hidden = !view.error;
  error.textContent = view.error;

  if (!view.loaded) {
    const loading = node('li', 'articles-loading');
    loading.append(node('span', 'lines-spinner'));
    root.replaceChildren(...(view.loading ? [loading] : []));
    $('#articles-none').hidden = true;
    return;
  }
  const counts = articleCounts(view.list, view.filter.company);
  renderToolbar(counts);
  const shown = filterArticles(view.list, view.filter);
  $('#articles-none').hidden = shown.length > 0;
  $('#articles-none').textContent = view.filter.missing && !view.filter.query
    ? 'У всех артикулов есть макет.'
    : 'Ничего не нашлось. Проверьте артикул или название.';
  $('#articles-shown').textContent = shown.length === view.list.length
    ? ''
    : ` · Показано ${shown.length} ${plural(shown.length, 'артикул', 'артикула', 'артикулов')} из ${view.list.length}`;
  root.replaceChildren(...shown.map(articleCard));
  observePreviews(root);
}

function articleCard(article) {
  const card = node('li', 'article-card');
  const ok = hasLayout(article);
  card.dataset.state = ok ? 'ok' : 'problem';

  const preview = node(ok ? 'a' : 'div', 'article-preview');
  if (ok) {
    preview.href = article.url;
    preview.target = '_blank';
    preview.rel = 'noopener noreferrer';
    preview.setAttribute('aria-label', `Открыть макет ${article.layout} в Яндекс Диске (откроется в новой вкладке)`);
    preview.dataset.path = article.path;
    paintPreview(preview);
  } else {
    preview.append(node('span', 'article-preview-note', 'Нет макета'));
  }
  card.append(preview);

  const body = node('div', 'article-body');
  const head = node('p', 'article-head');
  head.append(node('strong', '', article.sku), node('span', '', [companyName(article.companyId), article.size].filter(Boolean).join(' · ')));
  body.append(head, node('h2', 'article-name', article.name || 'Без названия'));
  if (ok) {
    const link = node('a', 'article-file', article.layout);
    link.href = article.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(node('span', 'visually-hidden', ' (откроется в новой вкладке)'));
    body.append(link);
  } else {
    body.append(node('p', 'article-problem', problemText(article)));
  }
  body.append(node('small', 'article-row', `Строка ${article.row} на листе «${companyName(article.companyId)}»`));
  card.append(body);
  return card;
}

// ───── Превью ─────
// path → 'data:image/…' (готово) | '' (превью нет). Пока нет ключа — превью не загружено.
const previews = new Map();
const queued = new Set();
let running = 0;
let observer = null;

function paintPreview(box) {
  const path = box.dataset.path;
  if (!previews.has(path)) {
    box.dataset.preview = 'loading';
    if (!box.querySelector('.article-preview-spinner')) {
      box.replaceChildren(node('span', 'article-preview-spinner'));
    }
    return;
  }
  const src = previews.get(path);
  if (!src) {
    box.dataset.preview = 'none';
    box.replaceChildren(node('span', 'article-preview-note', 'Превью нет'));
    return;
  }
  box.dataset.preview = 'ready';
  const img = node('img');
  img.src = src;
  img.alt = '';
  img.decoding = 'async';
  box.replaceChildren(img);
}

function repaint(paths) {
  document.querySelectorAll('#article-cards .article-preview[data-path]').forEach(box => {
    if (paths.has(box.dataset.path)) paintPreview(box);
  });
}

function observePreviews(root) {
  observer?.disconnect();
  if (!('IntersectionObserver' in window)) {
    root.querySelectorAll('.article-preview[data-path]').forEach(box => want(box.dataset.path));
    return;
  }
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      want(entry.target.dataset.path);
    });
  }, { rootMargin: '400px 0px' });
  root.querySelectorAll('.article-preview[data-path]').forEach(box => {
    if (!previews.has(box.dataset.path)) observer.observe(box);
  });
}

function want(path) {
  if (!path || previews.has(path)) return;
  queued.add(path);
  pump();
}

// Не больше PREVIEW_PARALLEL запросов сразу, в каждом до PREVIEW_BATCH превью.
function pump() {
  while (running < PREVIEW_PARALLEL && queued.size) {
    const batch = [...queued].slice(0, PREVIEW_BATCH);
    batch.forEach(path => queued.delete(path));
    running += 1;
    layoutPreviewsRequest(batch)
      .then(payload => {
        batch.forEach(path => previews.set(path, String(payload.previews?.[path] ?? '')));
      })
      .catch(error => {
        // Сеть или Диск: превью не будет до обновления вкладки, карточка и ссылка остаются.
        console.warn('Превью макетов не загружены:', error);
        batch.forEach(path => previews.set(path, ''));
      })
      .finally(() => {
        running -= 1;
        repaint(new Set(batch));
        pump();
      });
  }
}

// ───── События ─────

export function initArticles() {
  $('#articles-company').addEventListener('click', event => {
    const button = event.target.closest('button[data-company]');
    if (!button) return;
    view.filter.company = button.dataset.company;
    renderArticles();
    $(`#articles-company button[data-company="${button.dataset.company}"]`)?.focus();
  });
  $('#articles-missing').addEventListener('click', () => {
    view.filter.missing = !view.filter.missing;
    renderArticles();
  });
  $('#articles-search').addEventListener('input', event => {
    view.filter.query = event.target.value;
    renderArticles();
  });
}

// Роль сменилась на клиента — список забывается: увидеть его снова можно только с админским паролем.
export function forgetArticles() {
  view.list = [];
  view.loaded = false;
  view.error = '';
  previews.clear();
  queued.clear();
}
