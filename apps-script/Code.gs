/**
 * FB Print — API B2B-калькулятора.
 * POST {action: 'catalog', password} — читает таблицу и отдаёт каталог (API_CONTRACT.md).
 * POST {action: 'order', password, …} — записывает заявку на лист «Заявки» и пересылает её менеджеру в Telegram.
 * POST {action: 'orders', password} — список заявок с листа «Заявки» со статусами.
 * Без верного пароля не отдаёт ничего. Другие листы не изменяет. Расчёт — в js/pricing.js.
 *
 * Скрипт создаётся из самой таблицы («Расширения» → «Apps Script») и работает только с ней:
 * право spreadsheets.currentonly не даёт доступа к другим таблицам владельца.
 *
 * Свойства скрипта («Настройки проекта» → «Свойства скрипта»):
 * ACCESS_PASSWORD — пароль для входа на сайт; пока он не задан, скрипт никому ничего не отдаёт;
 * TELEGRAM_BOT_TOKEN — токен от @BotFather, TELEGRAM_CHAT_ID — чаты менеджеров через запятую.
 */

const ORDER_LIMIT = { count: 20, seconds: 600 };
const MAX_LINES = 300; // клиенты загружают свои таблицы: в заказе бывает 60 позиций и больше
const TELEGRAM_TEXT_LIMIT = 4000; // Telegram принимает до 4096 символов в сообщении
const ORDERS_SHEET = 'Заявки';
const SHIPPED = 'Отгружено';
const TIME_ZONE = 'Europe/Moscow';
const URGENCIES = ['Стандартный', 'Срочный', 'Экстренный'];

// Компания определяется листом, а не колонкой «Площадка».
const COMPANIES = [
  { id: 'global_food', name: 'Глобал Фуд', sheet: 'Список_артикулов_ГлобалФуд' },
  { id: 'studio_vkusa', name: 'Студия Вкуса', sheet: 'Список_артикулов_СтудияВкуса' }
];

// Открытый адрес ничего не отдаёт: пароль передаётся только в теле POST, а не в ссылке.
function doGet() {
  return json({ error: { code: 'ACCESS_DENIED', message: 'Доступ только по паролю через сайт калькулятора' } });
}

// Пароль сравнивается с ACCESS_PASSWORD. Неверный пароль отвечает с задержкой — так перебор идёт медленно.
function checkPassword(request) {
  const expected = PropertiesService.getScriptProperties().getProperty('ACCESS_PASSWORD');
  if (!expected) return { code: 'ACCESS_NOT_CONFIGURED', message: 'Доступ к калькулятору ещё не настроен' };
  if (typeof request.password === 'string' && request.password === expected) return null;
  Utilities.sleep(1500);
  return { code: 'ACCESS_DENIED', message: 'Неверный пароль' };
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
  let order;
  try {
    order = JSON.parse(e.postData.contents);
  } catch (error) {
    return json({ error: { code: 'INVALID_REQUEST', message: 'Неверный запрос' } });
  }
  const denied = checkPassword(order);
  if (denied) return json({ error: denied });

  if (order.action === 'catalog') {
    try {
      return json(readCatalog());
    } catch (error) {
      console.error(error);
      return json({ error: { code: 'CATALOG_READ_FAILED', message: `Не удалось прочитать таблицу: ${error.message}` } });
    }
  }
  if (order.action === 'orders') {
    try {
      return json({ orders: readOrders() });
    } catch (error) {
      console.error(error);
      return json({ error: { code: 'ORDERS_READ_FAILED', message: `Не удалось прочитать заявки: ${error.message}` } });
    }
  }
  try {
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
    const check = verifyPrices(order);
    // Номер выдаёт скрипт по листу «Заявки» и сразу занимает его строкой — так номера не повторяются.
    // Не записалось на лист — заявка не уходит: клиент увидит ошибку и сможет отправить снова.
    order.number = reserveOrderRow(order);
    try {
      sendTelegram(orderMessage(order, check), orderFile(order));
    } catch (error) {
      // Менеджер заявку не получил — убираем её строку, на листе остаются только доставленные заявки.
      removeOrderRow(order.number);
      throw error;
    }
    return json({ ok: true, number: order.number });
  } catch (error) {
    console.error(error);
    return json({ error: { code: 'ORDER_SEND_FAILED', message: 'Не удалось отправить заявку' } });
  }
}

// Похожа ли заявка на настоящую. Персональных данных в ней нет: номер, компания и позиции.
function validOrder(order) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  if (!lines.length || lines.length > MAX_LINES) return false;
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

  const header = `Новая заявка ${field(order.number, 30)} с калькулятора FB Print`;
  const warning = flagged ? `⚠ ВНИМАНИЕ: расхождения с таблицей в ${flagged} из ${lines.length} поз.` : null;
  const footer = [`Итого: ${moneyText(Number(order.total))}`, check.totalWarning || null, verdict];
  const join = parts => parts.filter(line => line !== null).join('\n');
  const text = join([header, warning, '', items.join('\n\n'), '', ...footer]);
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;

  // Большая заявка целиком в сообщение не влезает: сводка и позиции с расхождениями, полный список — в Excel.
  const companies = [...new Set(lines.map(line => field(line.company, 100)))].join(', ');
  const flaggedItems = lines
    .map((line, index) => (check.warnings[index] ? `${index + 1}. ${field(line.sku, 50)} — ${check.warnings[index].replace(/\n/g, '; ')}` : null))
    .filter(Boolean);
  const summary = [
    header,
    warning,
    '',
    `Компания: ${companies}`,
    `Позиций: ${lines.length}. Полный список — в файле Excel ниже.`,
    flaggedItems.length ? '' : null,
    flaggedItems.length ? 'Позиции с расхождениями:' : null
  ];
  const tail = ['', ...footer];
  const room = TELEGRAM_TEXT_LIMIT - join([...summary, ...tail]).length - 60;
  const listed = [];
  let used = 0;
  for (const item of flaggedItems) {
    if (used + item.length + 1 > room) {
      listed.push(`…и ещё ${flaggedItems.length - listed.length} — см. Excel`);
      break;
    }
    listed.push(item);
    used += item.length + 1;
  }
  return join([...summary, listed.length ? listed.join('\n') : null, ...tail]);
}

// Сверка цен с таблицей: клиент может подменить цены у себя в браузере, а скрипт — нет.
// Правила те же, что на сайте (js/pricing.js, quote): от минимального тиража — цена по срочности,
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

// Как roundMoney в js/format.js: до копеек, без хвостов двоичной арифметики (1,425 × 100 = 142,4999…).
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

// Лист «Заявки»: одна строка — одна заявка. Колонки A–D: номер, дата и время, компания, итого;
// E — статус, его ставит менеджер. Строка 1 — заголовки. Позиции заявки — в Telegram и в Excel.
// Номер — самый большой номер на листе плюс один, с датой: «FB-0002 от 09.11.2026».
// Если удалить последнюю строку, её номер выдастся снова; удаление строк из середины номера не меняет.
// Блокировка не даёт двум одновременным заявкам получить один номер и одну строку.
function reserveOrderRow(order) {
  const sheet = ordersSheet();
  const companies = [...new Set(order.lines.map(line => field(line.company, 100)).filter(Boolean))].join(', ');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const last = sheet.getLastRow();
    const numbers = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues() : [];
    const max = numbers.reduce((top, [value]) => Math.max(top, Number((String(value).match(/^FB-(\d+)/) || [])[1]) || 0), 0);
    const number = `FB-${String(max + 1).padStart(4, '0')} от ${Utilities.formatDate(new Date(), TIME_ZONE, 'dd.MM.yyyy')}`;
    sheet.getRange(last + 1, 1, 1, 4).setValues([[number, new Date(), cellText(companies), Number(order.total)]]);
    SpreadsheetApp.flush();
    return number;
  } finally {
    lock.releaseLock();
  }
}

function removeOrderRow(number) {
  try {
    const sheet = ordersSheet();
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const last = sheet.getLastRow();
      const numbers = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues() : [];
      for (let index = numbers.length - 1; index >= 0; index--) {
        if (text(numbers[index][0]) === number) {
          sheet.deleteRow(index + 2);
          return;
        }
      }
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(`Строка заявки ${number} не удалена: ${error.message}`);
  }
}

function ordersSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDERS_SHEET);
  if (!sheet) throw new Error(`нет листа «${ORDERS_SHEET}»`);
  return sheet;
}

// Текст из заявки, который начинается с «=», «+», «-» или «@», таблица приняла бы за формулу.
// Апостроф в начале оставляет его обычным текстом и в ячейке не виден.
function cellText(value) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

// Все заявки с листа «Заявки», новые сверху. Пароль один на всех, поэтому заявки видят все клиенты.
// Строки без номера вида FB-… пропускаются. Статус «shipped» — в колонке E стоит «Отгружено».
function readOrders() {
  return rows(SpreadsheetApp.getActiveSpreadsheet(), ORDERS_SHEET, 1)
    .filter(row => /^FB-\d+/.test(text(row[0])))
    .map(row => ({
      number: text(row[0]),
      sentAt: Object.prototype.toString.call(row[1]) === '[object Date]' ? row[1].toISOString() : text(row[1]),
      company: text(row[2]),
      total: toNumber(row[3]) || 0,
      status: text(row[4]) === SHIPPED ? 'shipped' : ''
    }))
    .reverse()
    .slice(0, 500);
}

// Запустите один раз в редакторе: колонка E «Статус» на листе «Заявки» — пусто или «Отгружено»,
// а строка отгруженной заявки подсвечивается зелёным. Данные в колонках A–D не трогает.
function setupOrdersSheet() {
  const sheet = ordersSheet();
  sheet.getRange('D1').copyTo(sheet.getRange('E1'), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sheet.getRange('E1').setValue('Статус');
  sheet.setColumnWidth(5, 150);
  const status = sheet.getRange('E2:E');
  status.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([SHIPPED], true)
    .setAllowInvalid(false)
    .build());
  const shipped = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$E2="${SHIPPED}"`)
    .setBackground('#d9ead3')
    .setRanges([sheet.getRange('A2:E')])
    .build();
  sheet.setConditionalFormatRules(sheet.getConditionalFormatRules()
    .filter(rule => !String((rule.getBooleanCondition() || { getCriteriaValues: () => [] }).getCriteriaValues()[0] || '').includes(`"${SHIPPED}"`))
    .concat(shipped));
  const filter = sheet.getFilter();
  if (filter) filter.remove();
  sheet.getRange('A1:E').createFilter();
  console.log('Лист «Заявки» настроен: колонка «Статус», выбор «Отгружено», зелёные строки.');
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
