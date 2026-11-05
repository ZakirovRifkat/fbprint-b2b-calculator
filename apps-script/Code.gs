/**
 * FB Print — API B2B-калькулятора.
 * GET ?action=catalog — читает таблицу и отдаёт каталог (API_CONTRACT.md).
 * POST {action: 'order'} — пересылает заявку менеджеру в Telegram.
 * Таблицу не изменяет и ничего не рассчитывает. Проверка каталога — в app.js.
 *
 * Скрипт создаётся из самой таблицы («Расширения» → «Apps Script») и читает только её:
 * право spreadsheets.currentonly не даёт доступа к другим таблицам владельца.
 *
 * Свойства скрипта («Настройки проекта» → «Свойства скрипта»):
 * TELEGRAM_BOT_TOKEN — токен от @BotFather, TELEGRAM_CHAT_ID — чаты менеджеров через запятую.
 */

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
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('скрипт не привязан к таблице — создайте его через «Расширения» → «Apps Script» в самой таблице');

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
    if (!validOrder(order)) {
      return json({ error: { code: 'INVALID_ORDER', message: 'Заявка заполнена неверно' } });
    }
    if (!withinLimit()) {
      return json({ error: { code: 'TOO_MANY_ORDERS', message: 'Слишком много заявок. Попробуйте через несколько минут' } });
    }
    sendTelegram(orderMessage(order, verifyPrices(order)), orderFile(order));
    return json({ ok: true });
  } catch (error) {
    console.error(error);
    return json({ error: { code: 'ORDER_SEND_FAILED', message: 'Не удалось отправить заявку' } });
  }
}

// Похожа ли заявка на настоящую. Персональных данных в ней нет: номер, компания и позиции.
function validOrder(order) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  if (!/^FB-\d{4}-\d{4}$/.test(field(order.number, 20)) || !lines.length || lines.length > 50) return false;
  if (!(Number(order.total) > 0)) return false;
  return lines.every(line => {
    const quantity = Number(line.quantity);
    return Number.isInteger(quantity) && quantity > 0
      && Number(line.unitPrice) > 0 && Number(line.total) > 0
      && URGENCIES.includes(field(line.urgency, 20));
  });
}

function orderMessage(order, check) {
  const lines = order.lines;
  const items = lines.map((line, index) => [
    `${index + 1}. ${field(line.company, 100)} · ${field(line.sku, 50)}`,
    field(line.name, 200),
    `${integerText(Number(line.quantity))} шт. · ${field(line.urgency, 20)} · ${moneyText(Number(line.unitPrice))} = ${moneyText(Number(line.total))}`,
    field(line.condition, 60),
    check.warnings[index]
  ].filter(Boolean).join('\n'));

  const flagged = check.warnings.filter(Boolean).length;
  const verdict = check.error
    ? `⚠ ${check.error}. Проверьте цены перед счётом.`
    : flagged || check.totalWarning
      ? '⚠ Цены не совпадают с таблицей FB Print — проверьте перед счётом.'
      : '✅ Цены сверены с таблицей FB Print.';

  const text = [
    `Новая заявка ${field(order.number, 20)} с калькулятора FB Print`,
    flagged ? `⚠ ВНИМАНИЕ: расхождения с таблицей в ${flagged} из ${lines.length} поз.` : null,
    '',
    items.join('\n\n'),
    '',
    `Итого: ${moneyText(Number(order.total))}`,
    check.totalWarning || null,
    verdict
  ].filter(line => line !== null).join('\n');
  return text.length > 4000 ? `${text.slice(0, 3990)}\n…` : text;
}

// Сверка цен с таблицей: клиент может подменить цены у себя в браузере, а скрипт — нет.
// Правила те же, что на сайте (app.js, quote): от минимального тиража — цена по срочности,
// в диапазоне сниженного тиража — цена сниженного тиража и только стандартный срок.
// Скрипт ничего не пересчитывает в заявке, только помечает расхождения для менеджера.
const URGENCY_KEYS = { 'Стандартный': 'standard', 'Срочный': 'urgent', 'Экстренный': 'emergency' };

function verifyPrices(order) {
  let catalog;
  try {
    catalog = readCatalog();
  } catch (error) {
    console.error(error);
    return { error: `Цены не проверены: ${error.message}`, warnings: order.lines.map(() => ''), totalWarning: '' };
  }
  const companyIds = new Map(catalog.companies.map(company => [company.name, company.id]));
  const categories = new Map(catalog.categories.map(category => [category.id, category]));
  const warnings = order.lines.map(line => lineWarnings(line, catalog.articles, companyIds, categories));

  const linesTotal = roundMoney(order.lines.reduce((sum, line) => sum + Number(line.total), 0));
  const totalWarning = Math.abs(linesTotal - roundMoney(Number(order.total))) > 0.005
    ? `⚠ «Итого» не равно сумме позиций: по позициям ${moneyText(linesTotal)}`
    : '';
  return { error: null, warnings, totalWarning };
}

function lineWarnings(line, articles, companyIds, categories) {
  const companyId = companyIds.get(field(line.company, 100));
  const sku = field(line.sku, 50);
  const article = articles.find(item => item.companyId === companyId && item.sku === sku);
  if (!article) return '⚠ Такого артикула нет в каталоге этой компании';
  const category = categories.get(article.categoryId);
  if (!category) return '⚠ У артикула в таблице не заполнена категория';

  const quantity = Number(line.quantity);
  const urgency = URGENCY_KEYS[field(line.urgency, 20)];
  const minimum = toNumber(category.minimumQuantity);
  const reduced = category.reducedRun;
  let expected;
  if (quantity >= minimum) {
    expected = category.prices[urgency];
  } else if (!reduced || quantity < toNumber(reduced.minQuantity) || quantity > toNumber(reduced.maxQuantity)) {
    return `⚠ Тираж меньше минимального заказа по таблице`;
  } else if (urgency !== 'standard') {
    return `⚠ ${field(line.urgency, 20)} заказ по таблице — только от ${integerText(minimum)} шт.`;
  } else {
    expected = reduced.price;
  }
  expected = roundMoney(toNumber(expected));

  const unitPrice = roundMoney(Number(line.unitPrice));
  const problems = [];
  if (!(expected > 0)) problems.push('⚠ В таблице не заполнена цена для этого срока');
  else if (Math.abs(unitPrice - expected) > 0.005) problems.push(`⚠ Цена в заявке ${moneyText(unitPrice)}, по таблице ${moneyText(expected)}`);
  if (Math.abs(roundMoney(quantity * unitPrice) - roundMoney(Number(line.total))) > 0.005) {
    problems.push(`⚠ Сумма не равна тираж × цена: должно быть ${moneyText(roundMoney(quantity * unitPrice))}`);
  }
  return problems.join('\n');
}

// Как roundMoney в app.js: до копеек, без хвостов двоичной арифметики (1,425 × 100 = 142,4999…).
function roundMoney(value) {
  return Math.round(Number((value * 100).toFixed(6))) / 100;
}

// Значение ячейки как число: getValues() отдаёт числа, но цену могли ввести текстом «1,20 ₽».
function toNumber(value) {
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\s/g, '').replace(/[^\d,.-]/g, '').replace(',', '.'));
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
// Excel заявки, который собрал сайт: тот же файл, что клиент скачивает себе.
// Принимаем только настоящий .xlsx (zip, начинается с «PK») до 500 КБ; имя файла задаём сами.
// Возвращает Blob или null — без файла заявка всё равно отправляется.
function orderFile(order) {
  if (typeof order.file !== 'string' || !order.file || order.file.length > 700000) return null;
  try {
    const bytes = Utilities.base64Decode(order.file);
    if (bytes.length > 500000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
    return Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${order.number}.xlsx`);
  } catch (error) {
    console.error(`Файл заявки не прочитан: ${error.message}`);
    return null;
  }
}

// Сообщение уходит в каждый чат, следом — файл заявки, если он есть.
// Заявка считается отправленной, если сообщение дошло хотя бы до одного чата.
function sendTelegram(text, file) {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('TELEGRAM_BOT_TOKEN');
  const chatIds = String(properties.getProperty('TELEGRAM_CHAT_ID') || '')
    .split(',')
    .map(chatId => chatId.trim())
    .filter(Boolean);
  if (!token || !chatIds.length) throw new Error('Не заданы TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID');

  const call = (method, chatId, payload) => {
    const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/${method}`, Object.assign({
      method: 'post',
      muteHttpExceptions: true
    }, payload));
    if (response.getResponseCode() === 200) return true;
    console.error(`Чат ${chatId}, ${method}: Telegram ответил ${response.getResponseCode()}: ${response.getContentText()}`);
    return false;
  };

  const delivered = chatIds.filter(chatId => call('sendMessage', chatId, {
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  }));
  if (!delivered.length) throw new Error('Telegram не принял заявку ни в один чат');

  // UrlFetchApp сам отправляет multipart/form-data, если в payload есть Blob.
  if (file) {
    delivered.forEach(chatId => call('sendDocument', chatId, {
      payload: { chat_id: chatId, document: file, caption: `Excel заявки ${file.getName().replace(/\.xlsx$/, '')}` }
    }));
  }
}

// Напишите боту или добавьте его в группу, затем запустите — в журнале будет chat_id.
// Telegram хранит сообщения для бота только 24 часа, поэтому пишите боту прямо перед запуском.
function findChatId() {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) {
    console.log('Сначала добавьте свойство TELEGRAM_BOT_TOKEN.');
    return;
  }
  const call = method => JSON.parse(UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/${method}`, { muteHttpExceptions: true }).getContentText());

  const bot = call('getMe');
  if (!bot.ok) {
    console.log(`Telegram не принял токен: ${bot.description}. Проверьте TELEGRAM_BOT_TOKEN.`);
    return;
  }
  console.log(`Бот: @${bot.result.username}`);

  const webhook = call('getWebhookInfo');
  if (webhook.ok && webhook.result.url) {
    console.log(`У бота настроен webhook (${webhook.result.url}) — из-за него сообщения сюда не попадают. Узнайте chat_id через @userinfobot.`);
    return;
  }

  const chats = new Map();
  (call('getUpdates').result || []).forEach(update => {
    const chat = (update.message || update.my_chat_member || {}).chat;
    if (chat) chats.set(chat.id, chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username);
  });
  if (!chats.size) {
    console.log(`Новых сообщений нет. Каждый получатель: откройте @${bot.result.username}, отправьте любое сообщение, затем запустите функцию снова.`);
    return;
  }
  chats.forEach((name, id) => console.log(`chat_id: ${id} — ${name}`));
  console.log(`Для TELEGRAM_CHAT_ID: ${[...chats.keys()].join(', ')}`);
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
