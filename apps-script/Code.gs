/**
 * FB Print — API B2B-калькулятора.
 * GET ?action=catalog — читает таблицу и отдаёт каталог (API_CONTRACT.md).
 * POST {action: 'order'} — пересылает заявку менеджеру в Telegram.
 * Таблицу не изменяет и ничего не рассчитывает. Проверка каталога — в app.js.
 *
 * Свойства скрипта («Настройки проекта» → «Свойства скрипта»):
 * TELEGRAM_BOT_TOKEN — токен от @BotFather, TELEGRAM_CHAT_ID — чат менеджера.
 */

const SPREADSHEET_ID = '1tT1gWfyTSa0A3kOdsCHLALh7NPYB1797SvND44_7gJg';
const ORDER_LIMIT = { count: 20, seconds: 600 };
const URGENCIES = ['Стандартный', 'Срочный', 'Экстренный'];

// Компания определяется листом, а не колонкой «Площадка».
const COMPANIES = [
  { id: 'global_food', name: 'Глобал Фуд', sheet: 'Список_артикулов_ГлобалФуд' },
  { id: 'studio_vkusa', name: 'Студия Вкуса', sheet: 'Список_артикулов_СтудияВкуса' }
];

function doGet(e) {
  if (!e || !e.parameter || e.parameter.action !== 'catalog') {
    return json({ error: { code: 'UNKNOWN_ACTION', message: 'Нужен параметр ?action=catalog' } });
  }
  try {
    return json(readCatalog());
  } catch (error) {
    console.error(error);
    return json({ error: { code: 'CATALOG_READ_FAILED', message: `Не удалось прочитать таблицу: ${error.message}` } });
  }
}

function readCatalog() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

  // «Категории»: строка 1 — заголовки, примечания под таблицей без номера в колонке A.
  const categories = rows(spreadsheet, 'Категории', 1)
    .filter(row => text(row[0]))
    .map(row => ({
      id: text(row[0]),
      size: text(row[1]),
      color: text(row[2]),
      minimumQuantity: row[4],
      rollQuantity: row[5] === '' ? null : row[5],
      lanes: row[6] === '' ? null : row[6],
      multiple: row[7],
      prices: { standard: row[3], urgent: row[11], emergency: row[9] },
      reducedRun: row[14] === '' ? null : { minQuantity: row[14], maxQuantity: row[16], price: row[17] }
    }));

  // Листы артикулов: строка 1 — название компании, строка 2 — заголовки.
  const articles = [];
  COMPANIES.forEach(company => {
    rows(spreadsheet, company.sheet, 2)
      .filter(row => text(row[0]) || text(row[2]) || text(row[5]))
      .forEach(row => articles.push({
        companyId: company.id,
        sku: text(row[2]),
        categoryId: text(row[0]),
        name: text(row[5])
      }));
  });

  return {
    schemaVersion: 1,
    version: new Date().toISOString(),
    companies: COMPANIES.map(({ id, name }) => ({ id, name })),
    categories,
    articles
  };
}

function doPost(e) {
  try {
    const order = JSON.parse(e.postData.contents);
    if (order.action !== 'order') {
      return json({ error: { code: 'UNKNOWN_ACTION', message: 'Неизвестное действие' } });
    }
    // Поле-ловушка скрыто от людей. Заполнил — значит бот: отвечаем «ок» и ничего не шлём.
    if (order.website) return json({ ok: true });
    const message = orderMessage(order);
    if (!message) {
      return json({ error: { code: 'INVALID_ORDER', message: 'Заявка заполнена неверно' } });
    }
    if (!withinLimit()) {
      return json({ error: { code: 'TOO_MANY_ORDERS', message: 'Слишком много заявок. Попробуйте через несколько минут' } });
    }
    sendTelegram(message);
    return json({ ok: true });
  } catch (error) {
    console.error(error);
    return json({ error: { code: 'ORDER_SEND_FAILED', message: 'Не удалось отправить заявку' } });
  }
}

// Возвращает текст сообщения или null, если заявка не похожа на настоящую.
// Персональных данных в заявке нет: номер, компания и позиции.
function orderMessage(order) {
  const number = field(order.number, 20);
  const lines = Array.isArray(order.lines) ? order.lines : [];
  if (!/^FB-\d{4}-\d{4}$/.test(number) || !lines.length || lines.length > 50) return null;

  const items = lines.map((line, index) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const total = Number(line.total);
    const urgency = field(line.urgency, 20);
    if (!Number.isInteger(quantity) || quantity <= 0 || !(unitPrice > 0) || !(total > 0) || !URGENCIES.includes(urgency)) {
      return null;
    }
    return [
      `${index + 1}. ${field(line.company, 100)} · ${field(line.sku, 50)}`,
      field(line.name, 200),
      `${integerText(quantity)} шт. · ${urgency} · ${moneyText(unitPrice)} = ${moneyText(total)}`,
      field(line.condition, 60)
    ].filter(Boolean).join('\n');
  });
  if (items.includes(null) || !(Number(order.total) > 0)) return null;

  const text = [
    `Новая заявка ${number} с калькулятора FB Print`,
    '',
    items.join('\n\n'),
    '',
    `Итого: ${moneyText(Number(order.total))}`,
    'Цены рассчитаны на сайте — проверьте перед счётом.'
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return text.length > 4000 ? `${text.slice(0, 3990)}\n…` : text;
}

function field(value, maxLength) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, maxLength);
}

function integerText(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function moneyText(value) {
  const [whole, cents] = value.toFixed(2).split('.');
  return `${integerText(Number(whole))},${cents} ₽`;
}

// Общий лимит на всех: защищает чат менеджера от потока спама.
function withinLimit() {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get('orders') || 0);
  if (count >= ORDER_LIMIT.count) return false;
  cache.put('orders', String(count + 1), ORDER_LIMIT.seconds);
  return true;
}

// TELEGRAM_CHAT_ID — один номер чата или несколько через запятую: «123456789, 987654321».
// Заявка считается отправленной, если дошла хотя бы до одного чата; сбои пишутся в журнал.
function sendTelegram(text) {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('TELEGRAM_BOT_TOKEN');
  const chatIds = String(properties.getProperty('TELEGRAM_CHAT_ID') || '')
    .split(',')
    .map(chatId => chatId.trim())
    .filter(Boolean);
  if (!token || !chatIds.length) throw new Error('Не заданы TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID');

  const failures = chatIds.filter(chatId => {
    const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 200) return false;
    console.error(`Чат ${chatId}: Telegram ответил ${response.getResponseCode()}: ${response.getContentText()}`);
    return true;
  });
  if (failures.length === chatIds.length) throw new Error('Telegram не принял заявку ни в один чат');
}

// Напишите боту или добавьте его в группу, затем запустите — в журнале будет chat_id.
function findChatId() {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  JSON.parse(response.getContentText()).result.forEach(update => {
    const chat = (update.message || update.my_chat_member || {}).chat;
    if (chat) console.log(`chat_id: ${chat.id} — ${chat.title || chat.username || chat.first_name}`);
  });
}

function rows(spreadsheet, sheetName, headerRows) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`нет листа «${sheetName}»`);
  return sheet.getDataRange().getValues().slice(headerRows);
}

function text(value) {
  return String(value).trim();
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

// Проверка в редакторе: выберите функцию и нажмите «Выполнить».
function test() {
  const catalog = readCatalog();
  console.log(`Категорий: ${catalog.categories.length}, артикулов: ${catalog.articles.length}`);
}
