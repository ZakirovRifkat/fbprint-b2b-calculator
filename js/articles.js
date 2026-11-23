// Вкладка «Артикулы» у администратора: каждый артикул обеих компаний с его макетом на Яндекс Диске.
// Только просмотр. Ссылка открывает файл в Диске у того, кто вошёл в этот аккаунт Яндекса.
// Превью скачивает Apps Script с токеном и отдаёт картинкой: файлы на Диске не публикуются.
import { state } from './state.js';
import { $, plural } from './format.js';
import { TRASH_ICON, adminErrorText, isAdmin, postAction } from './admin.js';
import { confirmAction } from './confirm.js';
import { toast } from './toast.js';

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
export const saveArticleRequest = fields => postAction('saveArticle', fields, 30000);
export const uploadLayoutRequest = fields => postAction('uploadLayout', fields, 180000);

export const LAYOUT_MAX_BYTES = 20 * 1024 * 1024;
const LAYOUT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

// Тип файла макета по MIME или расширению. '' — такой файл не принимаем.
export function layoutFileType(file) {
  const byMime = Object.values(LAYOUT_TYPES).includes(file?.type) ? file.type : '';
  const ext = String(file?.name ?? '').split('.').pop().toLowerCase();
  return byMime || LAYOUT_TYPES[ext] || '';
}

// Почему файл нельзя загрузить. '' — можно.
export function layoutFileProblem(file) {
  if (!file) return 'Файл не выбран';
  if (!layoutFileType(file)) return 'Макет должен быть JPG, PNG или PDF';
  if (!file.size) return 'Файл пустой';
  if (file.size > LAYOUT_MAX_BYTES) return 'Файл больше 20 МБ';
  return '';
}
export const deleteArticleRequest = fields => postAction('deleteArticle', fields, 30000);

// Поля формы артикула → тело запроса saveArticle. original — артикул, который правят (null — новый).
export function articleSavePayload(form, original = null) {
  const article = {};
  ['category', 'sku', 'size', 'color', 'name', 'layout'].forEach(key => {
    article[key] = String(form[key] ?? '').trim();
  });
  const payload = { company: original?.companyId ?? String(form.company ?? ''), article };
  if (original) {
    payload.row = original.row;
    payload.originalSku = original.sku;
  }
  return payload;
}

// Размер категории в записи листа артикулов: «80 × 120» → «80 х 120».
export const sheetSize = size => String(size ?? '').replace(/\s*×\s*/g, ' х ');

export const layoutPreviewsRequest = (paths, size) => postAction('layoutPreviews', size ? { paths, size } : { paths }, 60000);

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
  // Флаг загрузки ставится до отрисовки — иначе первый кадр вкладки пустой, без индикатора.
  view.loading = (async () => {
    await Promise.resolve();
    try {
      const payload = await articleLayoutsRequest();
      view.list = Array.isArray(payload.articles) ? payload.articles : [];
      view.companies = Array.isArray(payload.companies) ? payload.companies : [];
      view.files = Number(payload.files) || 0;
      view.fileNames = Array.isArray(payload.fileNames) ? payload.fileNames : [];
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
  renderArticles();
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
  // Пока список грузится, вместо надписи — заготовки карточек.
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
    root.replaceChildren(...(view.loading ? skeletonCards() : []));
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

// Пока список грузится — серые карточки той же сетки: видно, что идёт загрузка и что здесь будет.
function skeletonCards(count = 8) {
  return Array.from({ length: count }, () => {
    const card = node('li', 'article-card article-skeleton');
    card.setAttribute('aria-hidden', 'true');
    const preview = node('div', 'article-preview');
    const body = node('div', 'article-body');
    body.append(node('span', 'skeleton-line skeleton-line--short'), node('span', 'skeleton-line'), node('span', 'skeleton-line skeleton-line--mid'));
    card.append(preview, body);
    return card;
  });
}

function articleCard(article) {
  const card = node('li', 'article-card');
  const ok = hasLayout(article);
  card.dataset.state = ok ? 'ok' : 'problem';

  const preview = node(ok ? 'button' : 'div', 'article-preview');
  if (ok) {
    preview.type = 'button';
    preview.setAttribute('aria-label', `Посмотреть макет ${article.layout}`);
    preview.dataset.path = article.path;
    preview.addEventListener('click', () => openViewer(article));
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

  const actions = node('div', 'article-actions');
  const editButton = node('button', 'text-button', 'Изменить');
  editButton.type = 'button';
  editButton.setAttribute('aria-label', `Изменить артикул ${article.sku}`);
  editButton.addEventListener('click', () => openArticleForm(article));
  const remove = node('button', 'article-delete');
  remove.type = 'button';
  remove.title = 'Удалить артикул';
  remove.setAttribute('aria-label', `Удалить артикул ${article.sku}`);
  remove.innerHTML = TRASH_ICON;
  remove.addEventListener('click', () => deleteArticleWithConfirm(article, remove));
  const hasFile = Boolean(article.path) || article.problem === 'conflict' || article.problem === 'notFound';
  const uploadButton = node('button', 'text-button', hasFile ? 'Заменить макет' : 'Загрузить макет');
  uploadButton.type = 'button';
  uploadButton.dataset.uploadFor = `${article.companyId}/${article.row}`;
  uploadButton.setAttribute('aria-label', `${hasFile ? 'Заменить' : 'Загрузить'} макет артикула ${article.sku}`);
  uploadButton.addEventListener('click', () => pickLayoutFile(article));
  const links = node('div', 'article-action-links');
  links.append(editButton, uploadButton);
  actions.append(links, remove);
  body.append(actions);
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

// ───── Просмотр макета крупно ─────
// Клик по превью открывает окно просмотра: сразу показывается превью карточки, потом подгружается крупное (XL).
// Стрелки и клавиши ← → листают макеты из текущего списка (с учётом фильтров), Esc и клик мимо картинки закрывают.
const largePreviews = new Map(); // path → 'data:image/…' | ''
const viewer = { items: [], index: 0 };

// Макеты, которые листаются в окне просмотра: видимые сейчас карточки с макетом.
export const viewerItems = (list, filter = view.filter) => filterArticles(list, filter).filter(hasLayout);

export function openViewer(article) {
  viewer.items = viewerItems(view.list);
  viewer.index = Math.max(0, viewer.items.indexOf(article));
  const dialog = $('#layout-viewer');
  if (!dialog.open) dialog.showModal();
  showViewerItem();
}

function stepViewer(delta) {
  if (viewer.items.length < 2) return;
  viewer.index = (viewer.index + delta + viewer.items.length) % viewer.items.length;
  showViewerItem();
}

function showViewerItem() {
  const article = viewer.items[viewer.index];
  if (!article) return;
  $('#viewer-sku').textContent = `${article.sku} · ${companyName(article.companyId)}`;
  $('#viewer-name').textContent = article.layout;
  $('#viewer-link').href = article.url;
  $('#viewer-count').textContent = viewer.items.length > 1 ? `${viewer.index + 1} из ${viewer.items.length}` : '';
  $('#viewer-prev').hidden = viewer.items.length < 2;
  $('#viewer-next').hidden = viewer.items.length < 2;
  paintViewer(article);
  if (largePreviews.has(article.path)) return;
  layoutPreviewsRequest([article.path], 'XL')
    .then(payload => largePreviews.set(article.path, String(payload.previews?.[article.path] ?? '')))
    .catch(error => {
      console.warn('Крупное превью не загружено:', error);
      largePreviews.set(article.path, '');
    })
    .finally(() => {
      if (viewer.items[viewer.index]?.path === article.path) paintViewer(article);
    });
}

function paintViewer(article) {
  const image = $('#viewer-image');
  const src = largePreviews.get(article.path) || previews.get(article.path) || '';
  const waiting = !largePreviews.has(article.path);
  image.hidden = !src;
  if (src && image.getAttribute('src') !== src) image.src = src;
  image.alt = `Макет ${article.layout}`;
  $('#viewer-spinner').hidden = !waiting || Boolean(src);
  $('#viewer-note').hidden = Boolean(src) || waiting;
}

function initViewer() {
  const dialog = $('#layout-viewer');
  $('#viewer-close').addEventListener('click', () => dialog.close());
  $('#viewer-prev').addEventListener('click', () => stepViewer(-1));
  $('#viewer-next').addEventListener('click', () => stepViewer(1));
  // Клик по затемнению или пустому месту вокруг картинки закрывает просмотр.
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.classList?.contains('viewer-stage')) dialog.close();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') stepViewer(-1);
    if (event.key === 'ArrowRight') stepViewer(1);
  });
}

// ───── Добавление, изменение и удаление артикула ─────
// Форма пишет строку прямо в лист компании. После записи список и каталог загружаются заново:
// так номера строк и макеты на экране всегда совпадают с таблицей.
let editing = null; // артикул, который правят; null — новый

function fillCategorySelect(selected) {
  const select = $('#article-category');
  const options = [new Option('Без категории', '')];
  (state.data.categories ?? []).forEach(category => {
    options.push(new Option(`${category.id} · ${category.size} · ${category.color}`, category.id));
  });
  // Категория из таблицы, которой нет в каталоге, остаётся видна, чтобы её не потерять молча.
  if (selected && !options.some(option => option.value === selected)) options.push(new Option(`${selected} · нет на листе «Категории»`, selected));
  select.replaceChildren(...options);
  select.value = selected ?? '';
}

function fillLayoutOptions() {
  $('#article-layout-options').replaceChildren(...(view.fileNames ?? []).map(name => new Option(name)));
}

export function openArticleForm(article = null) {
  editing = article;
  const form = $('#article-form');
  form.reset();
  $('#article-form-title').textContent = article ? `Артикул ${article.sku}` : 'Новый артикул';
  $('#article-form-error').hidden = true;
  // Компанию выбирают только у нового артикула. У сохранённого она показана текстом: сменить её нельзя.
  const companies = $('#article-company');
  if (article) {
    companies.replaceChildren(node('span', 'article-company-name', companyName(article.companyId)));
  } else {
    companies.replaceChildren(...view.companies.map(company => {
      const label = node('label', 'article-company-option');
      const input = node('input');
      input.type = 'radio';
      input.name = 'company';
      input.value = company.id;
      input.required = true;
      input.checked = view.filter.company === company.id;
      label.append(input, node('span', '', company.name));
      return label;
    }));
    if (!companies.querySelector('input:checked')) companies.querySelector('input').checked = true;
  }
  fillCategorySelect(article?.category ?? '');
  fillLayoutOptions();
  form.elements.sku.value = article?.sku ?? '';
  form.elements.name.value = article?.name ?? '';
  form.elements.size.value = article?.size ?? '';
  form.elements.color.value = article?.color ?? '';
  // В поле — имя из колонки «Макет», а если она пуста — файл, который нашёлся по артикулу.
  // После сохранения это имя запишется в колонку, как это делает fillLayoutColumn.
  form.elements.layout.value = article?.layoutCell || article?.layout || '';
  setFormBusy(false);
  $('#article-dialog').showModal();
  form.elements[article ? 'name' : 'sku'].focus();
}

function setFormBusy(busy) {
  const submit = $('#article-submit');
  submit.disabled = busy;
  submit.ariaBusy = String(busy);
  $('#article-submit-label').textContent = busy ? 'Сохраняем…' : 'Сохранить';
}

function formValues() {
  const form = $('#article-form');
  const values = Object.fromEntries(new FormData(form).entries());
  values.company = form.querySelector('[name=company]:checked')?.value ?? '';
  return values;
}

async function submitArticleForm(event) {
  event.preventDefault();
  const payload = articleSavePayload(formValues(), editing);
  const error = $('#article-form-error');
  error.hidden = true;
  setFormBusy(true);
  try {
    const reply = await saveArticleRequest(payload);
    $('#article-dialog').close();
    toast(editing ? `Артикул ${reply.sku} сохранён` : `Артикул ${reply.sku} добавлен в таблицу, строка ${reply.row}`);
    await refreshAfterChange();
  } catch (failure) {
    error.textContent = adminErrorText(failure, 'Артикул не сохранён');
    error.hidden = false;
  } finally {
    setFormBusy(false);
  }
}

async function deleteArticleWithConfirm(article, button) {
  const confirmed = await confirmAction({
    title: `Удалить артикул ${article.sku}?`,
    message: `Строка ${article.row} исчезнет с листа «${companyName(article.companyId)}», строки ниже сдвинутся вверх. Отменить нельзя. Макет на Яндекс Диске останется.`,
    confirmLabel: 'Удалить'
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    await deleteArticleRequest({ company: article.companyId, row: article.row, sku: article.sku });
    toast(`Артикул ${article.sku} удалён`);
    await refreshAfterChange();
  } catch (failure) {
    button.disabled = false;
    toast(adminErrorText(failure, 'Артикул не удалён'), { persist: true });
  }
}

// После изменения: заново список артикулов и каталог калькулятора.
async function refreshAfterChange() {
  await loadArticles({ force: true });
  refreshCatalog?.();
}

let refreshCatalog = null;

function initArticleForm(onCatalogChange) {
  refreshCatalog = onCatalogChange;
  $('#add-article').addEventListener('click', () => openArticleForm());
  $('#layout-file').addEventListener('change', event => uploadLayout(event.target.files?.[0]));
  $('#article-form').addEventListener('submit', submitArticleForm);
  $('#article-cancel').addEventListener('click', () => $('#article-dialog').close());
  $('#close-article-dialog').addEventListener('click', () => $('#article-dialog').close());
  // Категория выбрана, а размер и цветность пусты — подставляем их из категории.
  $('#article-category').addEventListener('change', event => {
    const category = (state.data.categories ?? []).find(item => item.id === event.target.value);
    const form = $('#article-form');
    if (!category) return;
    if (!form.elements.size.value.trim()) form.elements.size.value = sheetSize(category.size);
    if (!form.elements.color.value.trim()) form.elements.color.value = category.color;
  });
  // Пока идёт сохранение, Esc окно не закрывает.
  $('#article-dialog').addEventListener('cancel', event => {
    if ($('#article-submit').disabled) event.preventDefault();
  });
}

// ───── Загрузка макета ─────
// Файл уходит в папку макетов на Яндекс Диске с именем по правилу («ГФ_19747_80x120.jpg»).
// Прежние файлы этого артикула скрипт убирает в корзину Диска: остаётся один актуальный макет.
let uploadFor = null;

function pickLayoutFile(article) {
  uploadFor = article;
  const input = $('#layout-file');
  input.value = '';
  input.click();
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('файл не прочитался'));
    reader.readAsDataURL(file);
  });
}

async function uploadLayout(file) {
  const article = uploadFor;
  uploadFor = null;
  if (!article || !file) return;
  const problem = layoutFileProblem(file);
  if (problem) {
    toast(problem, { persist: true });
    return;
  }
  const replacing = Boolean(article.path) || article.problem === 'conflict' || article.problem === 'notFound';
  if (replacing) {
    const old = article.path ? article.layout : (article.candidates ?? []).join(', ');
    const confirmed = await confirmAction({
      title: `Заменить макет ${article.sku}?`,
      message: `Новый файл станет макетом артикула ${article.sku} у всех компаний. ${old ? `Старый (${old}) уйдёт в корзину Яндекс Диска, оттуда его можно восстановить.` : ''}`.trim(),
      confirmLabel: 'Заменить'
    });
    if (!confirmed) return;
  }
  const button = document.querySelector(`[data-upload-for="${article.companyId}/${article.row}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = 'Загружаем…';
  }
  try {
    const data = await readBase64(file);
    const reply = await uploadLayoutRequest({
      company: article.companyId, row: article.row, sku: article.sku, fileName: file.name, type: layoutFileType(file), data
    });
    toast(`Макет ${reply.name} загружен на Яндекс Диск.`);
    await loadArticles({ force: true });
  } catch (failure) {
    toast(adminErrorText(failure, 'Макет не загружен'), { persist: true });
    renderArticles();
  }
}

// ───── События ─────

export function initArticles({ onCatalogChange } = {}) {
  initViewer();
  initArticleForm(onCatalogChange);
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
  largePreviews.clear();
  queued.clear();
  if ($('#layout-viewer')?.open) $('#layout-viewer').close();
  if ($('#article-dialog')?.open) $('#article-dialog').close();
}
