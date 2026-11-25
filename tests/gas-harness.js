// Apps Script в Node: apps-script/Code.gs выполняется в node:vm с поддельными сервисами Google.
// Сети нет: Telegram и Яндекс Диск — в памяти. Пароли и токены — тестовые строки.
import fs from 'node:fs';
import vm from 'node:vm';

const CODE_PATH = new URL('../apps-script/Code.gs', import.meta.url);
const CONSTS = 'LAYOUT_STATUS, LAYOUTS_DEFAULTS, COMPANIES, ORDERS_SHEET, LINES_SHEET, LINES_HEADER';

// Объекты из vm живут в другом realm: deepStrictEqual сравнивает прототипы. Приводим к обычным.
export const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export const TEST_PASSWORDS = { client: 'client-test-pass', admin: 'admin-test-pass' };
export const TEST_DISK_TOKEN = 'disk-test-token';

export const GF = 'Список_артикулов_ГлобалФуд';
export const SV = 'Список_артикулов_СтудияВкуса';
export const ORDERS = 'Заявки';
export const LINES = 'Позиции заявок';

// ───── Таблица ─────

function colNumber(letters) {
  return [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function chain() {
  const self = new Proxy({}, { get: (obj, key) => (key === 'then' ? undefined : () => self) });
  return self;
}

export function makeSheet(name, rows = []) {
  const data = rows.map(row => row.slice());
  const ops = [];
  // Формулы — отдельно: 'строка,колонка' → '=…'. Значение ячейки в data тесты задают сами.
  const formulas = new Map();
  const shiftFormulas = (fromRow, delta) => {
    const moved = new Map();
    formulas.forEach((formula, key) => {
      const [r, c] = key.split(',').map(Number);
      if (delta < 0 && r === fromRow) return;
      moved.set(r >= fromRow ? `${r + delta},${c}` : key, formula);
    });
    formulas.clear();
    moved.forEach((formula, key) => formulas.set(key, formula));
  };
  const width = () => Math.max(0, ...data.map(row => row.length));
  const ensure = (rowCount, colCount) => {
    while (data.length < rowCount) data.push([]);
    data.forEach(row => { while (row.length < colCount) row.push(''); });
  };
  const lastRow = () => {
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].some(value => value !== '' && value !== null && value !== undefined)) return i + 1;
    }
    return 0;
  };
  let activeRow = 1;

  function range(row, col, numRows = 1, numCols = 1) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) {
      throw new Error(`Range out of bounds: ${name} ${row},${col},${numRows},${numCols}`);
    }
    const r = {
      getRow: () => row,
      getColumn: () => col,
      getNumRows: () => numRows,
      getNumColumns: () => numCols,
      getValues() {
        ensure(row + numRows - 1, col + numCols - 1);
        return data.slice(row - 1, row - 1 + numRows).map(line => line.slice(col - 1, col - 1 + numCols));
      },
      getValue() {
        return r.getValues()[0][0];
      },
      setValues(values) {
        if (values.length !== numRows || values.some(line => line.length !== numCols)) {
          throw new Error(`The number of rows or columns in the data does not match the range (${name})`);
        }
        ensure(row + numRows - 1, col + numCols - 1);
        values.forEach((line, i) => line.forEach((value, j) => { data[row - 1 + i][col - 1 + j] = value; }));
        ops.push({ op: 'setValues', row, col, values: values.map(line => line.slice()) });
        return r;
      },
      getFormulas() {
        return Array.from({ length: numRows }, (_, i) => Array.from({ length: numCols }, (_, j) => formulas.get(`${row + i},${col + j}`) ?? ''));
      },
      setFormula(formula) {
        ensure(row, col);
        formulas.set(`${row},${col}`, formula);
        data[row - 1][col - 1] = '';
        ops.push({ op: 'setFormula', row, col, formula });
        return r;
      },
      setValue(value) {
        ensure(row, col);
        formulas.delete(`${row},${col}`);
        data[row - 1][col - 1] = value;
        ops.push({ op: 'setValues', row, col, values: [[value]] });
        return r;
      },
      setNumberFormat: () => r,
      setFontWeight: () => r,
      setBackground: () => r,
      copyTo: () => r,
      setDataValidation: () => r,
      createFilter: () => ({ remove() {} })
    };
    return r;
  }

  function a1(text) {
    const m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/i.exec(text);
    if (!m) throw new Error(`bad A1 ${text}`);
    const c1 = colNumber(m[1]);
    const r1 = m[2] ? Number(m[2]) : 1;
    const c2 = m[3] ? colNumber(m[3]) : c1;
    const r2 = m[3] ? (m[4] ? Number(m[4]) : Math.max(data.length, r1)) : r1;
    return range(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
  }

  const sheet = {
    data,
    ops,
    getName: () => name,
    getLastRow: lastRow,
    getLastColumn: width,
    getMaxRows: () => Math.max(1000, data.length),
    getDataRange() {
      const w = Math.max(1, width());
      const h = Math.max(1, lastRow());
      return range(1, 1, h, w);
    },
    getRange(a, b, c, d) {
      if (typeof a === 'string') return a1(a);
      return range(a, b, c ?? 1, d ?? 1);
    },
    formulas,
    deleteRow(row) {
      ops.push({ op: 'deleteRows', row, count: 1 });
      data.splice(row - 1, 1);
      shiftFormulas(row, -1);
    },
    insertRowAfter(row) {
      ops.push({ op: 'insertRowAfter', row });
      data.splice(row, 0, []);
      shiftFormulas(row + 1, 1);
    },
    deleteRows(row, count) {
      ops.push({ op: 'deleteRows', row, count });
      data.splice(row - 1, count);
    },
    setFrozenRows() {},
    setColumnWidth() {},
    getFilter: () => null,
    getConditionalFormatRules: () => [],
    setConditionalFormatRules() {},
    setActiveRow(rowNumber) { activeRow = rowNumber; },
    getActiveRange: () => range(activeRow, 1, 1, 1)
  };
  return sheet;
}

// Листы как в настоящей таблице: строка 1 — компания, строка 2 — заголовки A–G (H — «Макет», если layoutColumn).
// row: [категория, площадка, артикул, …, название] → A, B, C, F.
export function articleSheet(name, company, prefix, items, { layoutColumn = false } = {}) {
  const header = ['Категория', 'Площадка', 'Артикул', 'Размер', 'Материал', 'Наименование', 'Тип'];
  if (layoutColumn) header.push('Макет');
  const rows = [[company], header];
  items.forEach(item => {
    const row = [item.category ?? '1', item.place ?? prefix, item.sku, '', '', item.name ?? `Этикетка ${item.sku}`, ''];
    if (item.layout !== undefined) row[7] = item.layout;
    rows.push(row);
  });
  return makeSheet(name, rows);
}

// Категория 1: минимум 1000, стандарт 2 ₽, срочно 3 ₽, экстренно 4 ₽.
export function categoriesSheet() {
  return makeSheet('Категории', [
    ['ID', 'Размер', 'Цвет', 'Стандарт', 'Минимум', 'Рулон', 'Ручьи', 'Кратность', '', 'Экстренно', '', 'Срочно', '', '', 'Снижение от', '', 'до', 'цена'],
    ['1', '80x120', 'цвет', 2, 1000, '', '', 1000, '', 4, '', 3, '', '', '', '', '', '']
  ]);
}

// SKU 15053/18507/19455 у обеих компаний; 19743 дважды на листе ГФ.
export const GF_SKUS = ['10165', '10167', '10168', '10338', '10347', '10350', '10003', '15053', '18507', '19455', '19743', '19743'];
export const SV_SKUS = ['15053', '18507', '19455', '20001'];

export function defaultSheets({ layoutColumn = false, gfLayouts = {}, svLayouts = {} } = {}) {
  const gfItems = GF_SKUS.map(sku => ({ sku, layout: layoutColumn ? (gfLayouts[sku] ?? '') : undefined }));
  const svItems = SV_SKUS.map(sku => ({ sku, layout: layoutColumn ? (svLayouts[sku] ?? '') : undefined }));
  return {
    'Категории': categoriesSheet(),
    [GF]: articleSheet(GF, 'Глобал Фуд', 'ГФ', gfItems, { layoutColumn }),
    [SV]: articleSheet(SV, 'Студия Вкуса', 'СВ', svItems, { layoutColumn }),
    [ORDERS]: makeSheet(ORDERS, [['Номер', 'Дата', 'Компания', 'Итого', 'Статус', 'Папка макетов', 'Макеты', 'Проблемы с макетами']]),
    [LINES]: makeSheet(LINES, [['Номер заявки', 'Компания', 'Артикул', 'Название', 'Тираж', 'Срок', 'Цена за шт.', 'Сумма', 'Примечание']])
  };
}

// ───── Яндекс Диск в памяти ─────

export const DISK_ROOT = 'disk:/ФБ-ПРИНТ/ГлобалФуд_СтудияВкуса/Актуальные_макеты';
export const DISK_ORDERS = 'disk:/ФБ-ПРИНТ/Макеты_по_заявкам';
const API = 'https://cloud-api.yandex.net/v1/disk';
export const PREVIEW_HOST = 'https://downloader.disk.yandex.ru';
// Как у настоящего Диска — с портом в адресе загрузки.
export const UPLOAD_HOST = 'https://uploader1.disk.yandex.net:443';

const resp = (code, body) => ({
  getResponseCode: () => code,
  getContentText: () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body))
});

export function makeDisk() {
  const nodes = new Map(); // path → { type, publicUrl }
  const disk = {
    nodes,
    requests: [],
    operations: new Map(),
    asyncCopy: () => false, // (from, path) → true: 202 + операция
    opPollsBeforeSuccess: 1,
    fail: null,             // (req) → код ошибки или null
    pageLimit: null,        // ограничить размер страницы списка
    onCopy: null,           // (req) → void, вызывается перед копированием
    published: [],
    validToken: TEST_DISK_TOKEN, // токен, который Диск принимает; другой — 401
    addDir(path) { nodes.set(path, { type: 'dir' }); },
    addFile(path) { nodes.set(path, { type: 'file' }); },
    addLayouts(names, root = DISK_ROOT) {
      names.forEach(name => nodes.set(`${root}/${name}`, { type: 'file' }));
    },
    children(path) {
      return [...nodes.keys()].filter(p => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/')).sort();
    },
    filesIn(path) { return disk.children(path).filter(p => nodes.get(p).type === 'file').map(p => p.split('/').pop()); },
    dirsIn(path) { return disk.children(path).filter(p => nodes.get(p).type === 'dir'); },
    copies() { return disk.requests.filter(r => r.kind === 'copy'); },
    previewDownloads: [],
    trash: [],
    uploads: [],
    // PUT файла на адрес загрузки: токен туда не нужен и не должен уходить.
    uploadReply(url, options = {}) {
      const path = decodeURIComponent(new URL(url).pathname.replace(/^\/upload\//, ''));
      disk.uploads.push({ path, bytes: options.payload?.getBytes?.().length ?? 0, auth: options.headers?.Authorization ?? '' });
      nodes.set(path, { type: 'file' });
      return resp(201);
    },
    // Картинка превью: байты — путь файла, чтобы в тесте было видно, чьё это превью.
    previewReply(url, options = {}) {
      const path = decodeURIComponent(new URL(url).pathname.replace(/^\/preview\//, ''));
      disk.previewDownloads.push(path);
      if (options.headers?.Authorization !== `OAuth ${disk.validToken}`) return resp(401, 'Unauthorized');
      const bytes = [...Buffer.from(path, 'utf8')];
      return Object.assign(resp(200, ''), { getBlob: () => ({ getBytes: () => bytes, getContentType: () => 'image/jpeg' }) });
    }
  };
  ['disk:/ФБ-ПРИНТ', 'disk:/ФБ-ПРИНТ/ГлобалФуд_СтудияВкуса', DISK_ROOT].forEach(p => disk.addDir(p));

  disk.handle = (url, options = {}) => {
    const u = new URL(url);
    if (u.origin !== 'https://cloud-api.yandex.net') throw new Error(`Disk fake: unexpected host ${url}`);
    const method = String(options.method || 'get').toLowerCase();
    const q = Object.fromEntries(u.searchParams);
    const path = u.pathname.replace(/^\/v1\/disk/, '');
    let kind = 'other';
    if (path.startsWith('/operations/')) kind = 'operation';
    else if (path === '/resources/copy') kind = 'copy';
    else if (path === '/resources/publish') kind = 'publish';
    else if (path === '/resources' && method === 'put') kind = 'mkdir';
    else if (path === '/resources' && q.fields === 'public_url') kind = 'publicUrl';
    else if (path === '/resources' && q.fields === 'preview') kind = 'previewInfo';
    else if (path === '/resources/upload') kind = 'uploadLink';
    else if (path === '/resources' && method === 'delete') kind = 'delete';
    else if (path === '/resources') kind = 'list';
    else if (path === '' || path === '/') kind = 'info';
    const req = { kind, method, path, query: q, url };
    disk.requests.push(req);

    const auth = options.headers?.Authorization;
    if (auth !== `OAuth ${disk.validToken}`) return resp(401, { error: 'UnauthorizedError', message: 'Не авторизован.' });
    const failed = disk.fail?.(req);
    if (failed) return resp(failed, { error: 'Injected', message: `injected ${failed}` });

    if (kind === 'info') return resp(200, { total_space: 1, used_space: 0 });
    if (kind === 'operation') {
      const op = disk.operations.get(path.split('/').pop());
      if (!op) return resp(404, { error: 'NotFound' });
      if (op.polls++ < disk.opPollsBeforeSuccess) return resp(200, { status: 'in-progress' });
      nodes.set(op.path, { type: 'file' });
      return resp(200, { status: 'success' });
    }
    if (kind === 'list') {
      if (!nodes.has(q.path) || nodes.get(q.path).type !== 'dir') return resp(404, { error: 'DiskNotFoundError' });
      const items = disk.children(q.path).map(p => ({ name: p.split('/').pop(), path: p, type: nodes.get(p).type }));
      const offset = Number(q.offset) || 0;
      const limit = Math.min(Number(q.limit) || 20, disk.pageLimit || Infinity);
      return resp(200, { _embedded: { items: items.slice(offset, offset + limit), total: items.length, offset, limit } });
    }
    if (kind === 'uploadLink') {
      if (nodes.has(q.path) && q.overwrite !== 'true') return resp(409, { error: 'DiskResourceAlreadyExistsError' });
      return resp(200, { href: `${UPLOAD_HOST}/upload/${encodeURIComponent(q.path)}`, method: 'PUT' });
    }
    if (kind === 'delete') {
      if (!nodes.has(q.path)) return resp(404, { error: 'DiskNotFoundError' });
      nodes.delete(q.path);
      disk.trash.push(q.path);
      return resp(204);
    }
    if (kind === 'previewInfo') {
      const node = nodes.get(q.path);
      if (!node || node.type !== 'file') return resp(404, { error: 'DiskNotFoundError' });
      if (node.noPreview) return resp(200, {});
      return resp(200, { preview: `${PREVIEW_HOST}/preview/${encodeURIComponent(q.path)}?size=${q.preview_size}` });
    }
    if (kind === 'publicUrl') {
      const node = nodes.get(q.path);
      if (!node) return resp(404, { error: 'DiskNotFoundError' });
      return resp(200, node.publicUrl ? { public_url: node.publicUrl } : {});
    }
    if (kind === 'mkdir') {
      if (nodes.has(q.path)) return resp(409, { error: 'DiskPathPointsToExistentDirectoryError' });
      const parent = q.path.slice(0, q.path.lastIndexOf('/'));
      if (parent !== 'disk:' && !nodes.has(parent)) return resp(409, { error: 'DiskPathDoesntExistsError' });
      nodes.set(q.path, { type: 'dir' });
      return resp(201, { href: `${API}/resources?path=${encodeURIComponent(q.path)}` });
    }
    if (kind === 'copy') {
      disk.onCopy?.(req);
      if (!nodes.has(q.from)) return resp(404, { error: 'DiskNotFoundError' });
      if (nodes.has(q.path) && q.overwrite !== 'true') return resp(409, { error: 'DiskResourceAlreadyExistsError' });
      if (disk.asyncCopy(q.from, q.path)) {
        const id = `op${disk.operations.size + 1}`;
        disk.operations.set(id, { path: q.path, polls: 0 });
        return resp(202, { href: `${API}/operations/${id}`, method: 'GET' });
      }
      nodes.set(q.path, { type: 'file' });
      return resp(201, { href: `${API}/resources?path=${encodeURIComponent(q.path)}` });
    }
    if (kind === 'publish') {
      const node = nodes.get(q.path);
      if (!node) return resp(404, { error: 'DiskNotFoundError' });
      node.publicUrl = `https://disk.yandex.ru/d/pub${disk.published.length + 1}`;
      disk.published.push(q.path);
      return resp(200, { href: `${API}/resources?path=${encodeURIComponent(q.path)}` });
    }
    throw new Error(`Disk fake: unexpected ${method} ${url}`);
  };
  return disk;
}

// ───── Загрузка Code.gs ─────

export function loadCodeGs(options = {}) {
  const props = Object.assign({
    ACCESS_PASSWORD: TEST_PASSWORDS.client,
    ADMIN_PASSWORD: TEST_PASSWORDS.admin,
    TELEGRAM_BOT_TOKEN: 'tg-test-token',
    TELEGRAM_CHAT_ID: '111',
    YANDEX_DISK_TOKEN: TEST_DISK_TOKEN
  }, options.props || {});
  Object.keys(props).forEach(key => { if (props[key] === null || props[key] === undefined) delete props[key]; });

  const sheets = options.sheets || defaultSheets(options.sheetOptions);
  const disk = makeDisk();
  if (options.layouts) disk.addLayouts(options.layouts);
  const telegram = [];
  // status ≠ 200 — Telegram не принимает сообщения (для сценариев со сбоем отправки).
  const telegramState = { status: 200 };
  // Письма через MailApp: quota — сколько ещё можно отправить сегодня, fail — текст ошибки отправки.
  const mail = [];
  const mailState = { quota: 100, fail: '' };
  const fetchLog = [];
  const sleeps = [];
  const logs = { log: [], warn: [], error: [] };
  const triggers = [];
  const cache = new Map();
  const locks = { scriptWaitThrows: false, documentTryLock: true };
  const ui = { alerts: [], menus: [] };
  let triggerSeq = 0;
  let activeSheet = null;

  const spreadsheet = {
    getSheetByName: name => sheets[name] || null,
    insertSheet(name) {
      sheets[name] = makeSheet(name, []);
      return sheets[name];
    },
    getSheets: () => Object.values(sheets)
  };

  const telegramHandle = (url, opts) => {
    const method = url.split('/').pop();
    const payload = typeof opts.payload === 'string' ? JSON.parse(opts.payload) : (opts.payload || {});
    if (telegramState.status !== 200) return resp(telegramState.status, { ok: false });
    telegram.push({ method, chatId: String(payload.chat_id), text: payload.text, caption: payload.caption });
    return resp(200, { ok: true, result: {} });
  };

  const route = (url, opts = {}) => {
    fetchLog.push({ url, method: String(opts.method || 'get').toLowerCase() });
    if (url.startsWith('https://api.telegram.org/')) return telegramHandle(url, opts);
    if (url.startsWith('https://cloud-api.yandex.net/')) return disk.handle(url, opts);
    if (url.startsWith(`${PREVIEW_HOST}/preview/`)) return disk.previewReply(url, opts);
    if (url.startsWith(`${UPLOAD_HOST}/upload/`)) return disk.uploadReply(url, opts);
    throw new Error(`no network in tests: ${url}`);
  };

  const makeLock = kind => ({
    waitLock() { if (kind === 'script' && locks.scriptWaitThrows) throw new Error('Lock timeout: another process was holding the lock'); },
    tryLock() { return kind === 'script' ? true : locks.documentTryLock; },
    releaseLock() {},
    hasLock: () => true
  });

  const triggerBuilder = handler => {
    const spec = { handler };
    const create = () => {
      const id = `trigger-${++triggerSeq}`;
      const trigger = { id, spec, getUniqueId: () => id, getHandlerFunction: () => handler };
      triggers.push(trigger);
      return trigger;
    };
    return {
      timeBased: () => ({
        after(ms) { spec.after = ms; return { create }; },
        everyHours(n) { spec.everyHours = n; return { create }; },
        everyMinutes(n) { spec.everyMinutes = n; return { create }; }
      })
    };
  };

  const pad = n => String(n).padStart(2, '0');
  const fakes = {
    console: {
      log: (...a) => logs.log.push(a.join(' ')),
      info: (...a) => logs.log.push(a.join(' ')),
      warn: (...a) => logs.warn.push(a.join(' ')),
      error: (...a) => logs.error.push(a.map(x => (x && x.message) || x).join(' '))
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getActiveSheet: () => activeSheet,
      flush() {},
      getUi: () => ({
        alert: message => { ui.alerts.push(message); },
        createMenu(title) {
          const menu = { title, items: [] };
          const builder = {
            addItem(label, fn) { menu.items.push([label, fn]); return builder; },
            addSeparator() { return builder; },
            addToUi() { ui.menus.push(menu); }
          };
          return builder;
        }
      }),
      CopyPasteType: { PASTE_FORMAT: 'PASTE_FORMAT', PASTE_VALUES: 'PASTE_VALUES' },
      newDataValidation: chain,
      newConditionalFormatRule: chain
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null),
        setProperty(key, value) { props[key] = String(value); return this; },
        deleteProperty(key) { delete props[key]; return this; },
        getProperties: () => ({ ...props })
      })
    },
    LockService: { getScriptLock: () => makeLock('script'), getDocumentLock: () => makeLock('document') },
    CacheService: {
      getScriptCache: () => ({ get: key => (cache.has(key) ? cache.get(key) : null), put: (key, value) => { cache.set(key, String(value)); }, remove: key => { cache.delete(key); } })
    },
    MailApp: {
      getRemainingDailyQuota: () => mailState.quota,
      sendEmail(message) {
        if (mailState.fail) throw new Error(mailState.fail);
        mail.push({ ...message });
        mailState.quota -= 1;
      }
    },
    UrlFetchApp: {
      fetch: (url, opts) => route(url, opts),
      fetchAll: requests => requests.map(r => route(r.url, r))
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger(trigger) {
        const index = triggers.findIndex(t => t.getUniqueId() === trigger.getUniqueId());
        if (index >= 0) triggers.splice(index, 1);
      },
      newTrigger: triggerBuilder
    },
    Utilities: {
      sleep: ms => { sleeps.push(ms); },
      formatDate(date, timeZone, format) {
        if (timeZone !== 'Europe/Moscow') throw new Error(`unexpected time zone ${timeZone}`);
        const d = new Date(date.getTime() + 3 * 3600e3);
        return format
          .replace('yyyy', d.getUTCFullYear())
          .replace('MM', pad(d.getUTCMonth() + 1))
          .replace('dd', pad(d.getUTCDate()))
          .replace('HH', pad(d.getUTCHours()))
          .replace('mm', pad(d.getUTCMinutes()))
          .replace('ss', pad(d.getUTCSeconds()));
      },
      base64Decode: text => [...Buffer.from(text, 'base64')],
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, type, name) => ({ getBytes: () => bytes, getContentType: () => type, getName: () => name })
    },
    ContentService: {
      createTextOutput: content => ({ getContent: () => content, setMimeType() { return this; } }),
      MimeType: { JSON: 'application/json' }
    }
  };

  const ctx = vm.createContext(fakes);
  const source = fs.readFileSync(CODE_PATH, 'utf8') + `\n;globalThis.__consts = { ${CONSTS} };`;
  vm.runInContext(source, ctx, { filename: 'Code.gs' });

  const harness = {
    ctx,
    consts: ctx.__consts,
    sheets,
    props,
    disk,
    telegram,
    telegramState,
    mail,
    mailState,
    fetchLog,
    sleeps,
    logs,
    triggers,
    cache,
    locks,
    ui,
    fakes,
    call(body) {
      return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
    },
    setActiveSheet(name, row) {
      activeSheet = sheets[name];
      if (row) activeSheet.setActiveRow(row);
    },
    // Строки «Заявок» без заголовка.
    orderRows: () => sheets[ORDERS].data.slice(1).filter(row => row.some(v => v !== '')),
    lineRows: () => sheets[LINES].data.slice(1).filter(row => row.some(v => v !== '')),
    rowOf(number) { return harness.orderRows().find(row => row[0] === number); },
    layoutCells(number) {
      const row = harness.rowOf(number);
      return row ? { url: row[5] ?? '', status: row[6] ?? '', problems: row[7] ?? '' } : null;
    },
    // Отправить заявку клиентом. lines — [[компания, артикул], …].
    order(lines, password = TEST_PASSWORDS.client, extra = {}) {
      const items = lines.map(([company, sku]) => ({
        company, sku, name: `Этикетка ${sku}`, quantity: 1000, urgency: 'Стандартный', unitPrice: 2, total: 2000
      }));
      return harness.call({ action: 'order', password, total: items.length * 2000, lines: items, ...extra });
    },
    runQueue(extra = {}) {
      return plain(ctx.runLayoutQueue({ deadline: Date.now() + 270000, ...extra }));
    },
    layoutMessages: () => telegram.filter(m => m.method === 'sendMessage' && !/^Новая заявка/.test(m.text || '')).map(m => m.text)
  };
  return harness;
}

// Строки заявки прямо на листах — без doPost (для сценариев с заданной датой и номером).
export function putOrder(h, number, sentAt, lines, layoutCells = ['', '', '']) {
  h.sheets[ORDERS].data.push([number, sentAt, [...new Set(lines.map(l => l[0]))].join(', '), lines.length * 2000, '', ...layoutCells]);
  lines.forEach(([company, sku]) => {
    h.sheets[LINES].data.push([number, company, sku, `Этикетка ${sku}`, 1000, 'Стандартный', 2, 2000, '']);
  });
}
