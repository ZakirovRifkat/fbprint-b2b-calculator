/**
 * FB Print — API B2B-калькулятора.
 * POST {action: 'catalog', password} — читает таблицу и отдаёт каталог (API_CONTRACT.md).
 * POST {action: 'order', password, …} — записывает заявку на лист «Заявки» и пересылает её менеджеру в Telegram.
 * POST {action: 'orders', password} — список заявок с листа «Заявки» со статусами.
 * POST {action: 'orderLines', password, number} — позиции одной заявки с листа «Позиции заявок».
 * POST {action: 'deleteOrder', password, number} — удаляет заявку и её позиции (только администратор).
 * POST {action: 'rebuildLayouts', password, number} — заново собирает папку макетов заявки (только администратор).
 * Без верного пароля не отдаёт ничего. Расчёт — в js/pricing.js.
 * Пишет только на листы «Заявки» и «Позиции заявок»; на листах артикулов — только колонку H «Макет»
 * и только функциями setupLayoutColumn и fillLayoutColumn, которые запускают в редакторе.
 *
 * После отправки заявки фоновый запуск по триггеру собирает на Яндекс Диске папку с макетами
 * её артикулов, публикует её и шлёт ссылку в Telegram (раздел «Макеты на Яндекс Диске» ниже).
 *
 * Скрипт создаётся из самой таблицы («Расширения» → «Apps Script») и работает только с ней:
 * право spreadsheets.currentonly не даёт доступа к другим таблицам владельца.
 *
 * Свойства скрипта («Настройки проекта» → «Свойства скрипта»):
 * ACCESS_PASSWORD — пароль клиентов; ADMIN_PASSWORD — пароль администратора (не задан — администратора нет);
 * пока не задан ни один пароль, скрипт никому ничего не отдаёт;
 * TELEGRAM_BOT_TOKEN — токен от @BotFather, TELEGRAM_CHAT_ID — чаты менеджеров через запятую;
 * YANDEX_DISK_TOKEN — OAuth-токен Яндекс Диска (не задан — макеты не собираются);
 * LAYOUTS_ROOT, LAYOUTS_ORDERS_ROOT — папка макетов и папка для папок заявок (по умолчанию LAYOUTS_DEFAULTS).
 */

const ORDER_LIMIT = { count: 20, seconds: 600 };
const MAX_LINES = 300; // клиенты загружают свои таблицы: в заказе бывает 60 позиций и больше
const TELEGRAM_TEXT_LIMIT = 4000; // Telegram принимает до 4096 символов в сообщении
const ORDERS_SHEET = 'Заявки';
const LINES_SHEET = 'Позиции заявок';
const LINES_HEADER = ['Номер заявки', 'Компания', 'Артикул', 'Название', 'Тираж', 'Срок', 'Цена за шт.', 'Сумма', 'Примечание'];
const SHIPPED = 'Отгружено';
const TIME_ZONE = 'Europe/Moscow';
const URGENCIES = ['Стандартный', 'Срочный', 'Экстренный'];

// Компания определяется листом, а не колонкой «Площадка».
// layoutPrefix — подпись компании в сообщениях о макетах: «ГФ 10165». Файл по ней не ищется.
const COMPANIES = [
  { id: 'global_food', name: 'Глобал Фуд', sheet: 'Список_артикулов_ГлобалФуд', layoutPrefix: 'ГФ' },
  { id: 'studio_vkusa', name: 'Студия Вкуса', sheet: 'Список_артикулов_СтудияВкуса', layoutPrefix: 'СВ' }
];

const ADMIN_REQUIRED = { code: 'ADMIN_REQUIRED', message: 'Это действие доступно только администратору' };
const INVALID_ORDER_NUMBER = { code: 'INVALID_ORDER_NUMBER', message: 'Неверный номер заявки' };
const LAYOUTS_NOT_CONFIGURED = { code: 'LAYOUTS_NOT_CONFIGURED', message: 'Сборка макетов не настроена: нет токена Яндекс Диска' };

// Открытый адрес ничего не отдаёт: пароль передаётся только в теле POST, а не в ссылке.
function doGet() {
  return json({ error: { code: 'ACCESS_DENIED', message: 'Доступ только по паролю через сайт калькулятора' } });
}

// 'admin' | 'client' | null. Админский пароль проверяется первым.
// ADMIN_PASSWORD, равный ACCESS_PASSWORD, админом не делает.
function passwordRole(password, accessPassword, adminPassword) {
  if (typeof password !== 'string' || !password) return null;
  if (adminPassword && adminPassword !== accessPassword && password === adminPassword) return 'admin';
  if (accessPassword && password === accessPassword) return 'client';
  return null;
}

// Пароль сравнивается с ADMIN_PASSWORD и ACCESS_PASSWORD. Неверный пароль отвечает с задержкой — так перебор идёт медленно.
// Роль считается заново на каждом запросе: сайт её не хранит и подделать не может.
function checkPassword(request) {
  const properties = PropertiesService.getScriptProperties();
  const access = properties.getProperty('ACCESS_PASSWORD');
  const admin = properties.getProperty('ADMIN_PASSWORD');
  if (!access && !admin) {
    return { role: null, error: { code: 'ACCESS_NOT_CONFIGURED', message: 'Доступ к калькулятору ещё не настроен' } };
  }
  const role = passwordRole(request.password, access, admin);
  if (role) return { role, error: null };
  Utilities.sleep(1500);
  return { role: null, error: { code: 'ACCESS_DENIED', message: 'Неверный пароль' } };
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
  if (!order || typeof order !== 'object') return json({ error: { code: 'INVALID_REQUEST', message: 'Неверный запрос' } });
  const access = checkPassword(order);
  if (access.error) return json({ error: access.error });
  const role = access.role;

  if (order.action === 'catalog') {
    try {
      return json(Object.assign({ role }, readCatalog()));
    } catch (error) {
      console.error(error);
      return json({ error: { code: 'CATALOG_READ_FAILED', message: `Не удалось прочитать таблицу: ${error.message}` } });
    }
  }
  if (order.action === 'orders') {
    try {
      const reply = { role };
      if (role === 'admin') reply.layoutsAlert = PropertiesService.getScriptProperties().getProperty('LAYOUT_ALERT') || '';
      reply.orders = readOrders(role);
      return json(reply);
    } catch (error) {
      console.error(error);
      return json({ error: { code: 'ORDERS_READ_FAILED', message: `Не удалось прочитать заявки: ${error.message}` } });
    }
  }
  if (order.action === 'orderLines') {
    try {
      return json({ lines: readOrderLines(field(order.number, 40)) });
    } catch (error) {
      console.error(error);
      return json({ error: { code: 'ORDER_LINES_READ_FAILED', message: `Не удалось прочитать позиции заявки: ${error.message}` } });
    }
  }
  if (order.action === 'deleteOrder') return json(deleteOrderReply(order, role));
  if (order.action === 'rebuildLayouts') return json(rebuildLayoutsReply(order, role));
  if (order.action === 'articleLayouts') return json(articleLayoutsReply(role));
  if (order.action === 'layoutPreviews') return json(layoutPreviewsReply(order, role));
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
    // Позиции — для подробностей заявки на сайте. Не записались — заявка всё равно уходит менеджеру:
    // все позиции есть в сообщении и в Excel.
    try {
      writeOrderLines(order);
    } catch (error) {
      console.error(`Позиции заявки ${order.number} не записаны: ${error.message}`);
    }
    try {
      sendTelegram(orderMessage(order, check), orderFile(order));
    } catch (error) {
      // Менеджер заявку не получил — убираем её строки, на листах остаются только доставленные заявки.
      removeOrderLines(order.number);
      removeOrderRow(order.number);
      throw error;
    }
    // Папку макетов собирает фоновый запуск; сбой очереди на ответ клиенту не влияет.
    try {
      queueLayouts(order.number);
    } catch (error) {
      console.error(`Макеты заявки ${order.number} не поставлены в очередь: ${error.message}`);
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
// E — статус, его ставит менеджер. Строка 1 — заголовки. Позиции заявки — на листе «Позиции заявок».
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
      deleteRowsWithNumber(sheet, number, true);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(`Строка заявки ${number} не удалена: ${error.message}`);
  }
}

// Удаляет строки, где в колонке A стоит этот номер, и возвращает их число. Блокировку берёт вызывающий.
// Соседние строки удаляются одним вызовом, снизу вверх — номера строк выше не сдвигаются.
// onlyLast — только самая нижняя строка (лист «Заявки»: номер последней заявки могут выдать снова).
function deleteRowsWithNumber(sheet, number, onlyLast) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const numbers = sheet.getRange(2, 1, last - 1, 1).getValues();
  const matches = [];
  for (let index = numbers.length - 1; index >= 0; index--) {
    if (text(numbers[index][0]) !== number) continue;
    matches.push(index + 2);
    if (onlyLast) break;
  }
  let start = 0;
  while (start < matches.length) {
    let end = start;
    while (end + 1 < matches.length && matches[end + 1] === matches[end] - 1) end++;
    sheet.deleteRows(matches[end], end - start + 1);
    start = end + 1;
  }
  return matches.length;
}

// Номер строки (2…) заявки с этим номером и, если sentAtMs задан, с этой датой в колонке B; 0 — нет.
// Без sentAtMs — самая нижняя строка с этим номером.
function findOrderRow(sheet, number, sentAtMs) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const values = sheet.getRange(2, 1, last - 1, 2).getValues();
  const anyTime = sentAtMs === undefined || sentAtMs === null;
  for (let index = values.length - 1; index >= 0; index--) {
    if (text(values[index][0]) !== number) continue;
    if (anyTime || dateMs(values[index][1]) === sentAtMs) return index + 2;
  }
  return 0;
}

// Миллисекунды даты из ячейки или null, если в ячейке не дата.
function dateMs(value) {
  return Object.prototype.toString.call(value) === '[object Date]' ? value.getTime() : null;
}

// Ошибка с кодом для ответа сайту.
function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function orderNotFound(number) {
  return { code: 'ORDER_NOT_FOUND', message: `Заявка ${number} не найдена — возможно, её уже удалили` };
}

// Ответ на deleteOrder. Роль проверяется на каждом запросе.
function deleteOrderReply(request, role) {
  if (role !== 'admin') return { error: ADMIN_REQUIRED };
  const number = field(request.number, 40);
  if (!/^FB-\d+/.test(number)) return { error: INVALID_ORDER_NUMBER };
  try {
    const { deletedLines } = deleteOrder(number);
    return { ok: true, number, deletedLines };
  } catch (error) {
    if (error.code === 'ORDER_NOT_FOUND') return { error: orderNotFound(number) };
    console.error(error);
    return { error: { code: 'ORDER_DELETE_FAILED', message: `Не удалось удалить заявку: ${error.message}` } };
  }
}

// Удаляет позиции заявки с «Позиции заявок», затем её строку с «Заявки» — под одной блокировкой.
// Позиции первыми: если номер выдадут снова, старые позиции к новой заявке не приклеятся.
// Возвращает { deletedLines }; нет строки — бросает Error с полем code = 'ORDER_NOT_FOUND', ничего не удаляя.
// Папка макетов на Яндекс Диске остаётся: в её имени время заявки, новая заявка с тем же номером в неё не попадёт.
function deleteOrder(number) {
  const orders = ordersSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!findOrderRow(orders, number)) throw codedError('ORDER_NOT_FOUND', `Заявка ${number} не найдена`);
    const lines = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LINES_SHEET);
    const deletedLines = lines ? deleteRowsWithNumber(lines, number, false) : 0;
    deleteRowsWithNumber(orders, number, true);
    SpreadsheetApp.flush();
    forgetLayoutJob(number);
    return { deletedLines };
  } finally {
    lock.releaseLock();
  }
}

// Лист «Позиции заявок»: одна строка — одна позиция, первая колонка — номер заявки с листа «Заявки».
// Позиции одной заявки пишутся одним блоком. Лист создаётся сам при первой заявке.
function writeOrderLines(order) {
  const values = order.lines.map(line => [
    order.number,
    cellText(field(line.company, 100)),
    cellText(field(line.sku, 40)),
    cellText(field(line.name, 300)),
    Number(line.quantity),
    field(line.urgency, 20),
    Number(line.unitPrice),
    Number(line.total),
    cellText(field(line.condition, 100))
  ]);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = linesSheet();
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, LINES_HEADER.length).setValues(values);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function removeOrderLines(number) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LINES_SHEET);
    if (!sheet) return;
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      deleteRowsWithNumber(sheet, number, false);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(`Позиции заявки ${number} не удалены: ${error.message}`);
  }
}

function linesSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(LINES_SHEET);
  if (sheet) return sheet;
  sheet = spreadsheet.insertSheet(LINES_SHEET);
  sheet.getRange(1, 1, 1, LINES_HEADER.length).setValues([LINES_HEADER]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('C2:C').setNumberFormat('@');
  sheet.getRange('G2:H').setNumberFormat('#,##0.00 ₽');
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(4, 480);
  return sheet;
}

// Позиции одной заявки в том порядке, в каком их отправил клиент. Нет листа — позиций нет.
function readOrderLines(number) {
  if (!/^FB-\d+/.test(number)) return [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LINES_SHEET);
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1)
    .filter(row => text(row[0]) === number)
    .map(row => ({
      company: text(row[1]),
      sku: text(row[2]),
      name: text(row[3]),
      quantity: toNumber(row[4]) || 0,
      urgency: text(row[5]),
      unitPrice: toNumber(row[6]) || 0,
      total: toNumber(row[7]) || 0,
      condition: text(row[8])
    }));
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
// Администратор получает ещё layouts из колонок F–H: статус сборки, ссылку на папку и проблемы.
function readOrders(role) {
  return rows(SpreadsheetApp.getActiveSpreadsheet(), ORDERS_SHEET, 1)
    .filter(row => /^FB-\d+/.test(text(row[0])))
    .map(row => {
      const order = {
        number: text(row[0]),
        sentAt: Object.prototype.toString.call(row[1]) === '[object Date]' ? row[1].toISOString() : text(row[1]),
        company: text(row[2]),
        total: toNumber(row[3]) || 0,
        status: text(row[4]) === SHIPPED ? 'shipped' : ''
      };
      if (role === 'admin') {
        order.layouts = {
          status: layoutStatusCode(row[6]),
          url: text(row[5] ?? ''),
          problems: text(row[7] ?? '').split(', ').map(item => item.trim()).filter(Boolean)
        };
      }
      return order;
    })
    .reverse()
    .slice(0, 500);
}

// Запустите один раз в редакторе: колонка E «Статус» на листе «Заявки» — пусто или «Отгружено»,
// а строка отгруженной заявки подсвечивается зелёным. Ещё пишет заголовки F–H для макетов.
// Данные в колонках A–D не трогает.
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
  setupLayoutHeaders(sheet);
  const filter = sheet.getFilter();
  if (filter) filter.remove();
  sheet.getRange('A1:H').createFilter();
  console.log('Лист «Заявки» настроен: колонка «Статус», выбор «Отгружено», зелёные строки, колонки макетов F–H.');
}

// Заголовки F–H «Заявок» в формате D1: ссылка на папку макетов, статус сборки, проблемы.
function setupLayoutHeaders(sheet) {
  sheet.getRange('D1').copyTo(sheet.getRange('F1:H1'), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sheet.getRange('F1:H1').setValues([ORDERS_LAYOUT_HEADER]);
  sheet.setColumnWidth(6, 280);
  sheet.setColumnWidth(7, 130);
  sheet.setColumnWidth(8, 320);
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

// ───────────────────────── Макеты на Яндекс Диске ─────────────────────────
//
// После отправки заявки её строка на «Заявках» получает в колонке G «В очереди» и ставится разовый триггер.
// Фоновый запуск (buildPendingLayouts) копирует макет каждого артикула заявки в папку заявки на Диске,
// публикует папку, пишет ссылку, статус и проблемы в F–H и шлёт ссылку в Telegram.
// Какой файл — макет артикула: колонка H «Макет» на листе артикулов, а если она пуста — правило имени
// «<буквы>_<артикул>_….jpg» (resolveLayout). Буквы ГФ/СВ в имени не важны: раньше все макеты называли «ГФ».
// Один артикул — один макет, даже если артикул есть у обеих компаний; в папку заявки он копируется один раз.
// Папка одна на заявку, без разделения по компаниям: макеты уходят на согласование одним письмом.

const LAYOUTS_DEFAULTS = {
  root: 'disk:/ФБ-ПРИНТ/ГлобалФуд_СтудияВкуса/Актуальные_макеты',
  ordersRoot: 'disk:/ФБ-ПРИНТ/Макеты_по_заявкам'
};

// Слова в колонке G «Заявок». Ключи уходят на сайт в layouts.status.
const LAYOUT_STATUS = {
  queued: 'В очереди', building: 'Собирается', done: 'Готово',
  partial: 'Не все макеты', empty: 'Макетов нет', failed: 'Ошибка'
};
const ORDERS_LAYOUT_HEADER = ['Папка макетов', 'Макеты', 'Проблемы с макетами'];

const LAYOUT_COLUMN = 8;            // H на листах артикулов
const LAYOUT_HEADER = 'Макет';
const LAYOUT_HANDLER = 'buildPendingLayouts';
const LAYOUT_RUN_MS = 270000;       // запуск по триггеру живёт до 6 минут — оставляем запас
const LAYOUT_MAX_ATTEMPTS = 3;
const LAYOUT_COPY_BATCH = 20;
const LAYOUT_RETRY_MS = 300000;
const LAYOUT_CONTINUE_MS = 60000;
const LAYOUT_LIST_MAX_FOLDERS = 200;
const LAYOUT_LIST_MAX_DEPTH = 4;
const LAYOUT_ALERT_EVERY_MS = 12 * 60 * 60 * 1000;
const LAYOUT_ALERT_TEXT = 'Яндекс Диск не принимает токен — макеты не собираются. Замените YANDEX_DISK_TOKEN в свойствах скрипта.';
const DISK_API = 'https://cloud-api.yandex.net/v1/disk';

// ───── Чистые функции: всё правило выбора файла и тексты. Без SpreadsheetApp, UrlFetchApp и свойств. ─────

// Ключ сравнения: обрезка, нижний регистр, «ё» → «е».
function layoutKey(value) {
  return String(value === undefined || value === null ? '' : value).trim().toLowerCase().replace(/ё/g, 'е');
}

// Имя без расширения: «ГФ_10165_3_80x120.jpg» → «ГФ_10165_3_80x120»; «.hidden» → «.hidden».
function fileStem(fileName) {
  const name = String(fileName === undefined || fileName === null ? '' : fileName);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

// { prefix, sku } из имени файла: части имени без расширения через «_», первая — префикс, вторая — артикул.
// Меньше двух частей или пустая часть — null. «ГФ_10338_D80.jpg» → { prefix: 'ГФ', sku: '10338' }.
// Регистр не меняется: «гф_10165.JPG» → { prefix: 'гф', sku: '10165' }; сравнивают через layoutKey.
function parseLayoutName(fileName) {
  const parts = fileStem(String(fileName === undefined || fileName === null ? '' : fileName).trim()).split('_');
  if (parts.length < 2) return null;
  const prefix = parts[0].trim();
  const sku = parts[1].trim();
  if (!prefix || !sku) return null;
  return { prefix, sku };
}

function byPath(a, b) {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

// Файлы ([{ name, path }]), подходящие артикулу по правилу: вторая часть имени равна артикулу по layoutKey.
// Первая часть (ГФ, СВ) не сравнивается. Порядок — по path.
function matchLayoutFiles(sku, files) {
  const wantedSku = layoutKey(sku);
  return files
    .filter(file => {
      const parsed = parseLayoutName(file.name);
      return Boolean(parsed) && layoutKey(parsed.sku) === wantedSku;
    })
    .sort(byPath);
}

// Файл для артикула. layout — значение колонки H (может быть пустым).
// Возвращает { file: { name, path } | null, problem: '' | 'missing' | 'conflict' | 'notFound', candidates: [имена] }.
//  H заполнена: файл с таким именем (layoutKey) есть — он; нет — 'notFound' (правило имени НЕ применяется),
//    candidates — [значение H], чтобы назвать его в сообщении.
//  H пуста: ровно один файл по правилу — он; ноль — 'missing'; два и больше — 'conflict' + candidates.
function resolveLayout(sku, layout, files) {
  const value = String(layout === undefined || layout === null ? '' : layout).trim();
  if (value) {
    const wanted = layoutKey(value);
    const file = files.filter(item => layoutKey(item.name) === wanted).sort(byPath)[0];
    return file ? { file, problem: '', candidates: [] } : { file: null, problem: 'notFound', candidates: [value] };
  }
  const matches = matchLayoutFiles(sku, files);
  if (matches.length === 1) return { file: matches[0], problem: '', candidates: [] };
  if (!matches.length) return { file: null, problem: 'missing', candidates: [] };
  return { file: null, problem: 'conflict', candidates: matches.map(file => file.name) };
}

// Подпись артикула в сообщениях: «ГФ 10165».
function articleLabel(prefix, sku) {
  return `${String(prefix).trim()} ${String(sku).trim()}`.trim();
}

// План копирования для заявки.
// lines — [{ company, sku }] (company — название, как в заявке); layouts — Map 'companyId/sku' → значение H;
// companies — COMPANIES; files — [{ name, path }].
// Повторы артикула одной компании считаются один раз; один исходный файл копируется один раз.
// Позиция неизвестной компании — проблема 'missing' с подписью «{company} {sku}».
// Возвращает { total, copies: [{ label, from, name }], problems: [{ label, kind, candidates }] } в порядке заявки.
function planLayoutCopies(lines, layouts, companies, files) {
  const byName = new Map(companies.map(company => [company.name, company]));
  const seen = new Set();
  const sources = new Set();
  const copies = [];
  const problems = [];
  lines.forEach(line => {
    const companyName = String(line.company ?? '').trim();
    const sku = String(line.sku ?? '').trim();
    if (!sku) return;
    const company = byName.get(companyName);
    const key = company ? `${company.id}/${sku}` : `?${companyName}/${sku}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!company) {
      problems.push({ label: articleLabel(companyName, sku), kind: 'missing', candidates: [] });
      return;
    }
    const label = articleLabel(company.layoutPrefix, sku);
    const layout = layouts && typeof layouts.get === 'function' ? layouts.get(key) : '';
    const result = resolveLayout(sku, layout || '', files);
    if (!result.file) {
      problems.push({ label, kind: result.problem, candidates: result.candidates });
      return;
    }
    if (sources.has(result.file.path)) return;
    sources.add(result.file.path);
    copies.push({ label, from: result.file.path, name: result.file.name });
  });
  return { total: seen.size, copies, problems };
}

// Текст проблемы для колонки H «Заявок» и Telegram:
// missing → «ГФ 10003», conflict → «ГФ 10165 — несколько файлов», notFound → «СВ 15053 — нет файла «…»»,
// failed (копирование не удалось) → «ГФ 10165 — {reason}».
function problemLabel(problem) {
  const candidates = problem.candidates || [];
  if (problem.kind === 'conflict') return `${problem.label} — несколько файлов`;
  if (problem.kind === 'notFound') return `${problem.label} — нет файла «${candidates[0] || ''}»`;
  if (problem.kind === 'failed') return `${problem.label} — ${problem.reason || 'не скопирован'}`;
  return problem.label;
}

// Ключ LAYOUT_STATUS по слову из колонки G; неизвестное или пустое — ''.
function layoutStatusCode(cellValue) {
  const word = String(cellValue === undefined || cellValue === null ? '' : cellValue).trim();
  if (!word) return '';
  return Object.keys(LAYOUT_STATUS).find(key => LAYOUT_STATUS[key] === word) || '';
}

// «FB-0042 от 09.11.2026 18.10.05» — номер и время отправки по Москве; время различает повторно выданные номера.
// Символы / \ : * ? " < > | заменяются на «-».
function orderFolderName(number, timeText) {
  return `${String(number).trim()} ${String(timeText || '').trim()}`.trim().replace(/[/\\:*?"<>|]/g, '-');
}

// 401, 403 → 'auth'; 423, 429, 5xx → 'retry'; 404 → 'notFound'; прочие ≥400 → 'fatal'; иначе ''.
function diskErrorKind(code) {
  if (code === 401 || code === 403) return 'auth';
  if (code === 404) return 'notFound';
  if (code === 423 || code === 429 || code >= 500) return 'retry';
  if (code >= 400) return 'fatal';
  return '';
}

// Error с полем kind: 'auth' | 'retry' | 'notFound' | 'fatal'.
function DiskError(kind, message) {
  const error = new Error(message);
  error.name = 'DiskError';
  error.kind = kind;
  return error;
}

// Склонение: pluralRu(5, 'файл', 'файла', 'файлов') → «файлов».
function pluralRu(n, one, few, many) {
  const abs = Math.abs(Math.trunc(Number(n) || 0));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Список не длиннее maxChars: «ГФ 10001, ГФ 10002 и ещё 5».
function limitedList(items, maxChars, separator = ', ') {
  const full = items.join(separator);
  if (full.length <= maxChars) return full;
  let result = '';
  for (let count = 1; count < items.length; count++) {
    const candidate = `${items.slice(0, count).join(separator)} и ещё ${items.length - count}`;
    if (candidate.length > maxChars) break;
    result = candidate;
  }
  return result || `всего ${items.length}`.slice(0, maxChars);
}

// Сообщение в Telegram о папке макетов заявки. result — ответ buildOrderLayouts; root — папка макетов.
function layoutsMessage(number, result, root) {
  const name = field(number, 40);
  if (result.status === 'failed') {
    const reason = field(result.reason, 1000).replace(/\.+$/, '') || 'неизвестная ошибка';
    return `⚠ Макеты к заявке ${name} не собраны: ${reason}.\nПовторить — «Собрать папку» на вкладке «Заявки» (вход с паролем администратора).`
      .slice(0, TELEGRAM_TEXT_LIMIT);
  }
  const copied = Number(result.copied) || 0;
  let head;
  if (result.status === 'done') head = `Макеты к заявке ${name}: ${copied} ${pluralRu(copied, 'файл', 'файла', 'файлов')}.\n${result.url}`;
  else if (result.status === 'empty') head = `⚠ Макеты к заявке ${name}: ни одного файла не найдено в «${root}».`;
  else head = `Макеты к заявке ${name}: ${copied} из ${Number(result.total) || 0} арт.\n${result.url}`;

  const problems = result.problems || [];
  const missing = problems.filter(problem => problem.kind !== 'conflict').map(problemLabel);
  const conflicts = problems
    .filter(problem => problem.kind === 'conflict')
    .map(problem => `${problem.label} (${(problem.candidates || []).join(', ')})`);
  const room = TELEGRAM_TEXT_LIMIT - head.length - 60;
  const share = missing.length && conflicts.length ? Math.floor(room / 2) : room;
  const lines = [];
  if (missing.length) lines.push(`⚠ Нет макета: ${limitedList(missing, share)}`);
  if (conflicts.length) lines.push(`⚠ Несколько макетов: ${limitedList(conflicts, share, '; ')}`);
  return (lines.length ? `${head}\n\n${lines.join('\n')}` : head).slice(0, TELEGRAM_TEXT_LIMIT);
}

function tokenMessage() {
  return '⚠ Яндекс Диск не принял токен YANDEX_DISK_TOKEN. Макеты к заявкам не собираются, заявки ждут в очереди.\n'
    + 'Получите новый токен и замените свойство скрипта — очередь соберётся сама в течение часа.';
}

// Чистое ядро fillLayoutColumn. articles — [{ sheet, row, companyId, prefix, sku, layout }] со всех листов
// (строки с артикулом); files — [{ name, path }]. Повторы артикула (19743 дважды) получают одно и то же имя файла.
// Возвращает { fills: [{ sheet, row, value }], missing: [label], conflicts: [{ label, files }],
//              notFound: [{ label, value }], unusedFiles: [name] }.
// Файл «использован», если на него ссылается H любого артикула или он подходит артикулу по правилу (и при конфликте).
function planLayoutFill(articles, files) {
  const fills = [];
  const missing = [];
  const conflicts = [];
  const notFound = [];
  const used = new Set();
  const reported = new Set();
  const once = key => {
    if (reported.has(key)) return false;
    reported.add(key);
    return true;
  };
  articles.forEach(article => {
    const sku = String(article.sku ?? '').trim();
    if (!sku) return;
    const label = articleLabel(article.prefix, sku);
    const key = `${article.companyId}/${layoutKey(sku)}`;
    const matches = matchLayoutFiles(sku, files);
    matches.forEach(file => used.add(file.path));
    const layout = String(article.layout ?? '').trim();
    if (layout) {
      const result = resolveLayout(sku, layout, files);
      if (result.file) used.add(result.file.path);
      else if (once(`notFound|${key}|${layoutKey(layout)}`)) notFound.push({ label, value: layout });
      return;
    }
    if (matches.length === 1) fills.push({ sheet: article.sheet, row: article.row, value: matches[0].name });
    else if (!matches.length) {
      if (once(`missing|${key}`)) missing.push(label);
    } else if (once(`conflict|${key}`)) {
      conflicts.push({ label, files: matches.map(file => file.name) });
    }
  });
  const unusedFiles = files.filter(file => !used.has(file.path)).map(file => file.name);
  return { fills, missing, conflicts, notFound, unusedFiles };
}

// ───── Настройки ─────

// Путь на Диске в виде «disk:/…» без «/» в конце.
function diskPath(value) {
  let path = String(value || '').trim().replace(/\/+$/, '');
  if (!/^disk:/.test(path)) path = `disk:${path.startsWith('/') ? '' : '/'}${path}`;
  return path;
}

// Ключ сравнения путей: регистр на Диске не важен.
function diskPathKey(path) {
  return layoutKey(diskPath(path));
}

// { token, root, ordersRoot, error }; error — если папка заявок совпадает с папкой макетов или лежит внутри неё
// (копии нашлись бы как макеты). Токен никуда не пишется и не логируется.
function layoutsConfig() {
  const properties = PropertiesService.getScriptProperties();
  const root = diskPath(properties.getProperty('LAYOUTS_ROOT') || LAYOUTS_DEFAULTS.root);
  const ordersRoot = diskPath(properties.getProperty('LAYOUTS_ORDERS_ROOT') || LAYOUTS_DEFAULTS.ordersRoot);
  const rootKey = diskPathKey(root);
  const ordersKey = diskPathKey(ordersRoot);
  const inside = ordersKey === rootKey || ordersKey.startsWith(`${rootKey}/`);
  return {
    token: properties.getProperty('YANDEX_DISK_TOKEN') || '',
    root,
    ordersRoot,
    error: inside ? `папка заявок ${ordersRoot} совпадает с папкой макетов ${root} или лежит внутри неё — измените LAYOUTS_ORDERS_ROOT` : ''
  };
}

// Значения колонки H обоих листов артикулов: Map 'companyId/sku' → имя файла ('' — пусто).
// Артикул на листе дважды: берётся первое непустое значение; два разных — предупреждение в журнал.
function readArticleLayouts() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const layouts = new Map();
  COMPANIES.forEach(company => {
    rows(spreadsheet, company.sheet, 2).forEach(row => {
      const sku = text(row[2] ?? '');
      if (!sku) return;
      const key = `${company.id}/${sku}`;
      const value = text(row[LAYOUT_COLUMN - 1] ?? '');
      const known = layouts.get(key);
      if (!value) {
        if (known === undefined) layouts.set(key, '');
      } else if (!known) {
        layouts.set(key, value);
      } else if (layoutKey(known) !== layoutKey(value)) {
        console.warn(`«${company.sheet}», артикул ${sku}: в колонке «${LAYOUT_HEADER}» разные файлы «${known}» и «${value}» — берётся первый`);
      }
    });
  });
  return layouts;
}

// ───── Клиент Яндекс Диска ─────

// Адрес запроса. Токен уходит только на cloud-api.yandex.net: чужой адрес операции не принимается.
function diskUrl(resource, query) {
  const url = /^https:\/\//.test(resource) ? resource : DISK_API + resource;
  if (!url.startsWith('https://cloud-api.yandex.net/')) throw DiskError('fatal', 'Яндекс Диск вернул неожиданный адрес операции');
  const params = Object.keys(query || {})
    .filter(key => query[key] !== undefined && query[key] !== null)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`);
  return params.length ? `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}` : url;
}

// Параметры запроса для UrlFetchApp.fetchAll. Нет токена — DiskError('auth').
function diskRequestParams(method, resource, query) {
  const token = PropertiesService.getScriptProperties().getProperty('YANDEX_DISK_TOKEN');
  if (!token) throw DiskError('auth', 'не задан YANDEX_DISK_TOKEN');
  return {
    url: diskUrl(resource, query),
    method,
    headers: { Authorization: `OAuth ${token}` },
    muteHttpExceptions: true
  };
}

// Ответ Диска как { code, body } (body — JSON или {}).
function diskReply(response) {
  const code = response.getResponseCode();
  let body = {};
  try {
    body = JSON.parse(response.getContentText() || '{}') || {};
  } catch (error) {
    body = {};
  }
  return { code, body };
}

// Любой успешный ответ Диска снимает предупреждение о токене.
function clearLayoutAlert(replies) {
  if (!replies.some(reply => reply.code >= 200 && reply.code < 300)) return;
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('LAYOUT_ALERT')) properties.deleteProperty('LAYOUT_ALERT');
}

// { code, body }; на HTTP-ошибках не бросает. Нет токена — DiskError('auth'); сбой сети — DiskError('retry').
function diskRequest(method, resource, query) {
  const { url, ...options } = diskRequestParams(method, resource, query);
  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (error) {
    throw DiskError('retry', `Яндекс Диск недоступен: ${error.message}`);
  }
  const reply = diskReply(response);
  clearLayoutAlert([reply]);
  return reply;
}

// Несколько запросов разом. Сбой сети — DiskError('retry').
function diskFetchAll(requests) {
  let responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch (error) {
    throw DiskError('retry', `Яндекс Диск недоступен: ${error.message}`);
  }
  const replies = responses.map(diskReply);
  clearLayoutAlert(replies);
  return replies;
}

// Бросает DiskError по ответу с ошибкой.
function diskFail(reply, what) {
  const kind = diskErrorKind(reply.code) || 'fatal';
  const detail = field(reply.body.message || reply.body.description || reply.body.error, 200);
  throw DiskError(kind, `${what}: Яндекс Диск ответил ${reply.code}${detail ? ` (${detail})` : ''}`);
}

// Все файлы в папке макетов: [{ name, path }]. Вложенные папки тоже (на случай, если появятся),
// не глубже LAYOUT_LIST_MAX_DEPTH и не больше LAYOUT_LIST_MAX_FOLDERS; skipPath не обходится.
function listLayoutFiles(root, skipPath) {
  const files = [];
  const skip = skipPath ? diskPathKey(skipPath) : '';
  const queue = [{ path: root, depth: 0 }];
  let folders = 0;
  while (queue.length) {
    const folder = queue.shift();
    if (++folders > LAYOUT_LIST_MAX_FOLDERS) {
      console.warn(`В папке макетов больше ${LAYOUT_LIST_MAX_FOLDERS} папок — остальные не просмотрены`);
      break;
    }
    let offset = 0;
    let total = 0;
    do {
      const reply = diskRequest('get', '/resources', {
        path: folder.path,
        limit: 1000,
        offset,
        fields: '_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.total'
      });
      if (reply.code === 404 && folder.depth === 0) throw DiskError('fatal', `Нет папки макетов ${root}`);
      if (reply.code === 404) break;
      if (reply.code >= 300) diskFail(reply, 'Список макетов');
      const embedded = reply.body._embedded || {};
      const items = embedded.items || [];
      total = Number(embedded.total) || 0;
      items.forEach(item => {
        if (item.type === 'file') files.push({ name: item.name, path: item.path });
        else if (item.type === 'dir' && folder.depth < LAYOUT_LIST_MAX_DEPTH && diskPathKey(item.path) !== skip) {
          queue.push({ path: item.path, depth: folder.depth + 1 });
        }
      });
      if (!items.length) break;
      offset += items.length;
    } while (offset < total);
  }
  return files;
}

function parentPath(path) {
  const index = path.lastIndexOf('/');
  return index > 'disk:'.length ? path.slice(0, index) : 'disk:/';
}

// Создаёт папку; уже есть — ничего не делает; нет родителя — создаёт его и пробует ещё раз.
function ensureDiskFolder(path, retried) {
  const reply = diskRequest('put', '/resources', { path });
  if (reply.code === 201) return;
  if (reply.code === 409) {
    if (reply.body.error === 'DiskPathPointsToExistentDirectoryError') return;
    if (reply.body.error === 'DiskPathDoesntExistsError' && !retried && parentPath(path) !== 'disk:/') {
      ensureDiskFolder(parentPath(path), false);
      ensureDiskFolder(path, true);
      return;
    }
  }
  diskFail(reply, `Папка ${path}`);
}

// Имена файлов, которые уже лежат в папке заявки (чтобы прерванная сборка не копировала их снова).
function listFolderNames(path) {
  const names = new Set();
  let offset = 0;
  let total = 0;
  do {
    const reply = diskRequest('get', '/resources', {
      path, limit: 1000, offset, fields: '_embedded.items.name,_embedded.items.type,_embedded.total'
    });
    if (reply.code === 404) return names;
    if (reply.code >= 300) diskFail(reply, 'Список папки заявки');
    const embedded = reply.body._embedded || {};
    const items = embedded.items || [];
    total = Number(embedded.total) || 0;
    items.forEach(item => {
      if (item.type === 'file') names.add(item.name);
    });
    if (!items.length) break;
    offset += items.length;
  } while (offset < total);
  return names;
}

// Копирует файлы в папку заявки пачками по LAYOUT_COPY_BATCH.
// Возвращает { copied, failed: [{ label, reason }], unfinished }; unfinished — время запуска кончилось.
// Отказ токена бросает DiskError('auth').
function copyLayouts(copies, folder, deadline, skipNames) {
  const skip = skipNames || new Set();
  const failed = [];
  let copied = 0;
  const todo = copies.filter(copy => {
    if (!skip.has(copy.name)) return true;
    copied++;
    return false;
  });
  for (let start = 0; start < todo.length; start += LAYOUT_COPY_BATCH) {
    if (Date.now() > deadline - 20000) return { copied, failed, unfinished: true };
    const batch = copyBatch(todo.slice(start, start + LAYOUT_COPY_BATCH), folder, deadline);
    copied += batch.copied;
    failed.push(...batch.failed);
    if (batch.unfinished) return { copied, failed, unfinished: true };
  }
  return { copied, failed, unfinished: false };
}

// Одна пачка: 201 — готово; 202 — Диск копирует сам, опрашиваем операцию; 404 — файл пропал;
// временная ошибка — один повтор через 2 с.
function copyBatch(batch, folder, deadline) {
  const failed = [];
  const operations = [];
  let copied = 0;
  const request = copy => diskRequestParams('post', '/resources/copy', { from: copy.from, path: `${folder}/${copy.name}`, overwrite: 'true' });
  let pending = batch.map(copy => ({ copy, tries: 0 }));
  while (pending.length) {
    const replies = diskFetchAll(pending.map(item => request(item.copy)));
    const again = [];
    replies.forEach((reply, index) => {
      const item = pending[index];
      const kind = diskErrorKind(reply.code);
      if (reply.code === 201) copied++;
      else if (reply.code === 202 && reply.body.href) operations.push({ copy: item.copy, href: reply.body.href });
      else if (kind === 'auth') throw DiskError('auth', `Копирование: Яндекс Диск ответил ${reply.code}`);
      else if (kind === 'notFound') failed.push({ label: item.copy.label, reason: 'файл пропал с Диска' });
      else if (kind === 'retry' && !item.tries) again.push({ copy: item.copy, tries: 1 });
      else failed.push({ label: item.copy.label, reason: `Яндекс Диск не скопировал файл (${reply.code})` });
    });
    if (again.length) Utilities.sleep(2000);
    pending = again;
  }

  let waiting = operations;
  while (waiting.length) {
    if (Date.now() > deadline) return { copied, failed, unfinished: true };
    Utilities.sleep(1000);
    const replies = diskFetchAll(waiting.map(operation => diskRequestParams('get', operation.href)));
    const next = [];
    replies.forEach((reply, index) => {
      const operation = waiting[index];
      const kind = diskErrorKind(reply.code);
      const status = reply.body.status;
      if (reply.code < 300 && status === 'success') copied++;
      else if (reply.code < 300 && status === 'failed') failed.push({ label: operation.copy.label, reason: 'Яндекс Диск не скопировал файл' });
      else if (reply.code < 300 || kind === 'retry') next.push(operation);
      else if (kind === 'auth') throw DiskError('auth', `Копирование: Яндекс Диск ответил ${reply.code}`);
      else failed.push({ label: operation.copy.label, reason: `Яндекс Диск не скопировал файл (${reply.code})` });
    });
    waiting = next;
  }
  return { copied, failed, unfinished: false };
}

// Публикует папку и возвращает публичную ссылку: открыть её может любой, у кого она есть.
function publishFolder(path) {
  const publish = diskRequest('put', '/resources/publish', { path });
  if (publish.code >= 300) diskFail(publish, 'Публикация папки');
  const info = diskRequest('get', '/resources', { path, fields: 'public_url' });
  if (info.code >= 300) diskFail(info, 'Ссылка на папку');
  if (!info.body.public_url) throw DiskError('retry', 'Яндекс Диск не вернул ссылку на папку');
  return info.body.public_url;
}

// ───── Сборка одной заявки ─────

// Возвращает { status, url, problems, copied, total, reason, unfinished }. status — ключ LAYOUT_STATUS.
// Бросает DiskError с kind 'auth' или 'retry' — их решает очередь.
// context — { config, files, layouts } (файлы и колонка H читаются один раз на запуск).
// fresh — собрать заново: файлы, которые уже есть в папке, копируются снова.
function buildOrderLayouts(number, sentAt, context, deadline, fresh) {
  const result = { status: 'failed', url: '', problems: [], copied: 0, total: 0, reason: '', unfinished: false };
  const lines = readOrderLines(number);
  if (!lines.length) return Object.assign(result, { reason: 'нет позиций на листе «Позиции заявок»' });
  const plan = planLayoutCopies(lines, context.layouts, COMPANIES, context.files);
  result.total = plan.total;
  if (!plan.copies.length) return Object.assign(result, { status: 'empty', problems: plan.problems });

  const timeText = dateMs(sentAt) === null ? '' : Utilities.formatDate(sentAt, TIME_ZONE, 'HH.mm.ss');
  const path = `${context.config.ordersRoot}/${orderFolderName(number, timeText)}`;
  ensureDiskFolder(path);
  const skipNames = fresh ? new Set() : listFolderNames(path);
  const copy = copyLayouts(plan.copies, path, deadline, skipNames);
  result.copied = copy.copied;
  if (copy.unfinished) return Object.assign(result, { status: 'building', unfinished: true });

  result.url = publishFolder(path);
  result.problems = plan.problems.concat(copy.failed.map(item => ({ label: item.label, kind: 'failed', candidates: [], reason: item.reason })));
  result.status = result.problems.length ? 'partial' : 'done';
  return result;
}

// ───── Служебные свойства очереди ─────

function readJsonProperty(name, fallback) {
  try {
    const value = JSON.parse(PropertiesService.getScriptProperties().getProperty(name) || 'null');
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeJsonProperty(name, value, empty) {
  const properties = PropertiesService.getScriptProperties();
  if (empty) properties.deleteProperty(name);
  else properties.setProperty(name, JSON.stringify(value));
}

function layoutAttempts(number) {
  return Number(readJsonProperty('LAYOUT_ATTEMPTS', {})[number]) || 0;
}

function setLayoutAttempts(number, count) {
  const attempts = readJsonProperty('LAYOUT_ATTEMPTS', {});
  if (count) attempts[number] = count;
  else delete attempts[number];
  writeJsonProperty('LAYOUT_ATTEMPTS', attempts, !Object.keys(attempts).length);
}

function isLayoutFresh(number) {
  return readJsonProperty('LAYOUT_FRESH', []).includes(number);
}

function setLayoutFresh(number, on) {
  const fresh = readJsonProperty('LAYOUT_FRESH', []).filter(item => item !== number);
  if (on) fresh.push(number);
  writeJsonProperty('LAYOUT_FRESH', fresh, !fresh.length);
}

// Заявку удалили или собрали — счётчик попыток и пометка «заново» больше не нужны.
function forgetLayoutJob(number) {
  setLayoutAttempts(number, 0);
  setLayoutFresh(number, false);
}

// Токен не принят: предупреждение для администратора на сайте и сообщение в Telegram не чаще раза в 12 часов.
function raiseLayoutAlert() {
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty('LAYOUT_ALERT', LAYOUT_ALERT_TEXT);
  const sentAt = Number(properties.getProperty('LAYOUT_ALERT_SENT_AT')) || 0;
  if (Date.now() - sentAt < LAYOUT_ALERT_EVERY_MS) return;
  try {
    sendTelegram(tokenMessage());
    properties.setProperty('LAYOUT_ALERT_SENT_AT', String(Date.now()));
  } catch (error) {
    console.error(`Предупреждение о токене Яндекс Диска не отправлено: ${error.message}`);
  }
}

function sendLayoutsTelegram(text) {
  try {
    sendTelegram(text);
  } catch (error) {
    console.error(`Сообщение о макетах не отправлено: ${error.message}`);
  }
}

// ───── Очередь ─────

// Ставит заявку в очередь сборки. Нет токена — сборка выключена, колонки F–H не трогаются.
function queueLayouts(number) {
  if (!layoutsConfig().token) return;
  const sheet = ordersSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const row = findOrderRow(sheet, number);
    if (!row) return;
    sheet.getRange(row, 6, 1, 3).setValues([['', LAYOUT_STATUS.queued, '']]);
    SpreadsheetApp.flush();
    ensureLayoutTrigger(10000);
  } finally {
    lock.releaseLock();
  }
}

// Разовый запуск сборки через delayMs, если он ещё не стоит. Ошибки — только в журнал.
function ensureLayoutTrigger(delayMs) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const id = properties.getProperty('LAYOUT_TRIGGER_ID');
    if (id && ScriptApp.getProjectTriggers().some(trigger => trigger.getUniqueId() === id)) return;
    const trigger = ScriptApp.newTrigger(LAYOUT_HANDLER).timeBased().after(delayMs).create();
    properties.setProperty('LAYOUT_TRIGGER_ID', trigger.getUniqueId());
  } catch (error) {
    console.error(`Запуск сборки макетов не запланирован: ${error.message}`);
  }
}

// Обработчик триггера. Разовый триггер удаляет за собой; ежечасный (setupLayouts) не трогает.
function buildPendingLayouts(e) {
  const properties = PropertiesService.getScriptProperties();
  const id = properties.getProperty('LAYOUT_TRIGGER_ID');
  if (e && id && String(e.triggerUid) === id) {
    ScriptApp.getProjectTriggers()
      .filter(trigger => trigger.getUniqueId() === id)
      .forEach(trigger => ScriptApp.deleteTrigger(trigger));
    properties.deleteProperty('LAYOUT_TRIGGER_ID');
  }
  const result = runLayoutQueue({ deadline: Date.now() + LAYOUT_RUN_MS });
  console.log(layoutQueueSummary(result));
  return result;
}

// Заявки с «В очереди» или «Собирается» в колонке G, сверху вниз.
function pendingLayoutRows() {
  const sheet = ordersSheet();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 8).getValues()
    .map(values => {
      const sentAtMs = dateMs(values[1]);
      const number = text(values[0] ?? '');
      return { number, sentAt: values[1], sentAtMs, status: layoutStatusCode(values[6]), key: `${number}|${sentAtMs}` };
    })
    .filter(item => /^FB-\d+/.test(item.number) && (item.status === 'queued' || item.status === 'building'));
}

// Пишет F–H строки заявки: cells — { status, url, problems }, поле undefined — ячейка не меняется.
// Строку ищет заново по номеру и дате (после удалений строки сдвигаются). Строки нет — false.
// expect — какой статус должен стоять в G. Другой — ничего не пишет и возвращает false:
// так конец сборки не затирает «В очереди», если админ нажал «Пересобрать папку» во время сборки.
function setLayoutCells(number, sentAtMs, cells, expect) {
  const sheet = ordersSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const row = findOrderRow(sheet, number, sentAtMs);
    if (!row) return false;
    const range = sheet.getRange(row, 6, 1, 3);
    const current = range.getValues()[0];
    if (expect && layoutStatusCode(current[1]) !== expect) return false;
    range.setValues([[
      cells.url === undefined ? current[0] : cellText(String(cells.url)),
      cells.status === undefined ? current[1] : LAYOUT_STATUS[cells.status],
      cells.problems === undefined ? current[2] : cellText(cells.problems.map(problemLabel).join(', ').slice(0, 45000))
    ]]);
    SpreadsheetApp.flush();
    return true;
  } finally {
    lock.releaseLock();
  }
}

// Сборка не удалась окончательно: «Ошибка» в G и сообщение в Telegram.
function failLayouts(item, reason) {
  if (!setLayoutCells(item.number, item.sentAtMs, { status: 'failed', url: '', problems: [] }, 'building')) return;
  forgetLayoutJob(item.number);
  sendLayoutsTelegram(layoutsMessage(item.number, { status: 'failed', reason }, ''));
}

// Заявки со статусом «В очереди» (и зависшие «Собирается») сверху вниз до deadline.
// Возвращает { processed: [номер…], remaining, stopped: '' | 'auth' | 'deadline' | 'busy' | 'config' }.
// Документная блокировка отдельна от блокировки скрипта: заявки и удаление не ждут долгую сборку.
function runLayoutQueue(options) {
  const deadline = (options && options.deadline) || Date.now() + LAYOUT_RUN_MS;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return { processed: [], remaining: -1, stopped: 'busy' };
  try {
    const processed = [];
    const stopped = layoutQueue(deadline, processed);
    return { processed, remaining: pendingLayoutRows().length, stopped };
  } finally {
    lock.releaseLock();
  }
}

function layoutQueue(deadline, processed) {
  const config = layoutsConfig();
  const start = pendingLayoutRows();
  if (!start.length) return '';

  if (config.error) {
    start.forEach(item => {
      forgetLayoutJob(item.number);
      setLayoutCells(item.number, item.sentAtMs, { status: 'failed', url: '', problems: [] });
    });
    sendLayoutsTelegram(`⚠ Макеты не собираются: ${config.error}.\nЗаявки: ${limitedList(start.map(item => item.number), 2000)}.`);
    return 'config';
  }

  // «Собирается» под нашей документной блокировкой — значит, прошлый запуск оборвался.
  start.filter(item => item.status === 'building').forEach(item => {
    const attempts = layoutAttempts(item.number) + 1;
    if (attempts >= LAYOUT_MAX_ATTEMPTS) {
      failLayouts(item, 'сборка несколько раз прервалась');
    } else {
      setLayoutAttempts(item.number, attempts);
      setLayoutCells(item.number, item.sentAtMs, { status: 'queued' });
    }
  });

  const tried = new Set();
  let context = null;
  for (;;) {
    const item = pendingLayoutRows().find(row => row.status === 'queued' && !tried.has(row.key));
    if (!item) return '';
    if (Date.now() >= deadline - 30000) {
      ensureLayoutTrigger(LAYOUT_CONTINUE_MS);
      return 'deadline';
    }
    tried.add(item.key);
    if (!setLayoutCells(item.number, item.sentAtMs, { status: 'building' })) continue;
    let result;
    try {
      if (!context) context = { config, files: listLayoutFiles(config.root, config.ordersRoot), layouts: readArticleLayouts() };
      result = buildOrderLayouts(item.number, item.sentAt, context, deadline, isLayoutFresh(item.number));
    } catch (error) {
      const stop = handleLayoutError(item, error);
      if (stop) return stop;
      continue;
    }
    if (result.unfinished) {
      // Скопированное в этом запуске уже свежее: продолжение пропустит эти файлы.
      if (setLayoutCells(item.number, item.sentAtMs, { status: 'queued' }, 'building')) setLayoutFresh(item.number, false);
      ensureLayoutTrigger(LAYOUT_CONTINUE_MS);
      return 'deadline';
    }
    // Не записалось — заявку удалили или снова поставили в очередь: её пометки не трогаем.
    if (!setLayoutCells(item.number, item.sentAtMs, { status: result.status, url: result.url, problems: result.problems }, 'building')) continue;
    forgetLayoutJob(item.number);
    processed.push(item.number);
    sendLayoutsTelegram(layoutsMessage(item.number, result, config.root));
  }
}

// Ошибка сборки одной заявки. Возвращает причину остановки очереди или '' — идти дальше.
function handleLayoutError(item, error) {
  const kind = error && error.kind;
  if (kind === 'auth') {
    setLayoutCells(item.number, item.sentAtMs, { status: 'queued' }, 'building');
    raiseLayoutAlert();
    console.error(`Макеты заявки ${item.number}: ${error.message}`);
    return 'auth';
  }
  if (kind === 'retry') {
    const attempts = layoutAttempts(item.number) + 1;
    console.error(`Макеты заявки ${item.number}, попытка ${attempts}: ${error.message}`);
    if (attempts < LAYOUT_MAX_ATTEMPTS) {
      setLayoutAttempts(item.number, attempts);
      setLayoutCells(item.number, item.sentAtMs, { status: 'queued' }, 'building');
      ensureLayoutTrigger(LAYOUT_RETRY_MS);
    } else {
      failLayouts(item, error.message);
    }
    return '';
  }
  console.error(`Макеты заявки ${item.number}: ${error && error.stack || error}`);
  failLayouts(item, (error && error.message) || String(error));
  return '';
}

function layoutQueueSummary(result) {
  const reasons = {
    busy: 'Сборка уже идёт в другом запуске — попробуйте через несколько минут.',
    auth: LAYOUT_ALERT_TEXT,
    deadline: 'Время запуска кончилось — остальное соберётся само в течение минуты.',
    config: 'Сборка выключена: неверные папки в свойствах скрипта, подробности — в журнале и Telegram.'
  };
  const lines = [`Собрано заявок: ${result.processed.length}.`];
  if (result.remaining > 0) lines.push(`В очереди: ${result.remaining}.`);
  if (reasons[result.stopped]) lines.push(reasons[result.stopped]);
  return lines.join('\n');
}

// ───── Пересобрать папку ─────

// Ответ на rebuildLayouts. Роль проверяется на каждом запросе.
function rebuildLayoutsReply(request, role) {
  if (role !== 'admin') return { error: ADMIN_REQUIRED };
  const number = field(request.number, 40);
  if (!/^FB-\d+/.test(number)) return { error: INVALID_ORDER_NUMBER };
  if (!layoutsConfig().token) return { error: LAYOUTS_NOT_CONFIGURED };
  try {
    return { ok: true, number, layouts: rebuildLayouts(number) };
  } catch (error) {
    if (error.code === 'ORDER_NOT_FOUND') return { error: orderNotFound(number) };
    console.error(error);
    return { error: { code: 'LAYOUTS_QUEUE_FAILED', message: `Не удалось поставить сборку макетов в очередь: ${error.message}` } };
  }
}

// Ставит самую нижнюю заявку с этим номером в очередь заново: G «В очереди», H пусто, ссылка в F остаётся.
// Сборка пойдёт с fresh = true: файлы в папке заявки копируются снова.
// Возвращает layouts для сайта; нет заявки — Error с code = 'ORDER_NOT_FOUND'.
function rebuildLayouts(number) {
  const sheet = ordersSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const row = findOrderRow(sheet, number);
    if (!row) throw codedError('ORDER_NOT_FOUND', `Заявка ${number} не найдена`);
    const url = text(sheet.getRange(row, 6).getValue() ?? '');
    sheet.getRange(row, 7, 1, 2).setValues([[LAYOUT_STATUS.queued, '']]);
    SpreadsheetApp.flush();
    setLayoutAttempts(number, 0);
    setLayoutFresh(number, true);
    ensureLayoutTrigger(10000);
    return { status: 'queued', url, problems: [] };
  } finally {
    lock.releaseLock();
  }
}

// ───── Вкладка «Артикулы» у администратора ─────
// Сайт показывает каждый артикул с его макетом: имя файла, ссылку на файл в Яндекс Диске и превью.
// Файлы не публикуются. Ссылка открывает файл у того, кто вошёл в этот аккаунт Яндекса,
// а превью скрипт сам скачивает с токеном и отдаёт сайту картинкой.

const LAYOUT_PREVIEW_SIZE = 'M';         // около 300 px по ширине: хватает для карточки
const LAYOUT_PREVIEW_BATCH = 12;         // превью за один запрос сайта
const LAYOUT_PREVIEW_CACHE_S = 21600;    // готовое превью лежит в кэше 6 часов
const LAYOUT_PREVIEW_CACHE_MAX = 100000; // CacheService хранит до 100 КБ на значение; больше — не кэшируем
const DISK_WEB = 'https://disk.yandex.ru/client/disk';

// Ссылка на файл в веб-интерфейсе Яндекс Диска: папка файла с открытым просмотром самого файла.
// 'disk:/ФБ-ПРИНТ/Макеты/ГФ_10165.jpg' → https://disk.yandex.ru/client/disk/ФБ-ПРИНТ/Макеты?idApp=client&dialog=slider&idDialog=%2Fdisk%2F…
function layoutWebUrl(path) {
  const relative = diskPath(path).replace(/^disk:\/?/, '');
  const folder = relative.split('/').slice(0, -1).map(encodeURIComponent).join('/');
  return `${DISK_WEB}/${folder}?idApp=client&dialog=slider&idDialog=${encodeURIComponent(`/disk/${relative}`)}`;
}

// Строки вкладки «Артикулы». sheets — [{ company, rows }] (строки листа без двух строк заголовка),
// files — [{ name, path }] из папки макетов. Макет выбирается тем же правилом, что и при сборке папки заявки.
// row — номер строки на листе, чтобы найти артикул в таблице.
function articleLayoutList(sheets, files) {
  const list = [];
  sheets.forEach(({ company, rows: sheetRows }) => {
    sheetRows.forEach((row, index) => {
      const sku = text(row[2] ?? '');
      if (!sku) return;
      const found = resolveLayout(sku, row[LAYOUT_COLUMN - 1], files);
      list.push({
        companyId: company.id,
        row: index + 3,
        sku,
        name: text(row[5] ?? ''),
        size: text(row[3] ?? ''),
        layout: found.file ? found.file.name : '',
        path: found.file ? found.file.path : '',
        url: found.file ? layoutWebUrl(found.file.path) : '',
        problem: found.problem,
        candidates: found.candidates
      });
    });
  });
  return list;
}

// Ответ на articleLayouts. Только администратору.
function articleLayoutsReply(role) {
  if (role !== 'admin') return { error: ADMIN_REQUIRED };
  const config = layoutsConfig();
  if (!config.token) return { error: LAYOUTS_NOT_CONFIGURED };
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const files = listLayoutFiles(config.root, config.ordersRoot);
    const sheets = COMPANIES.map(company => ({ company, rows: rows(spreadsheet, company.sheet, 2) }));
    return {
      ok: true,
      role,
      companies: COMPANIES.map(({ id, name }) => ({ id, name })),
      files: files.length,
      articles: articleLayoutList(sheets, files)
    };
  } catch (error) {
    console.error(error);
    const reason = error.kind === 'auth' ? LAYOUT_ALERT_TEXT : error.message;
    return { error: { code: 'ARTICLES_READ_FAILED', message: `Не удалось прочитать артикулы и макеты: ${reason}` } };
  }
}

// Путь лежит внутри папки макетов. Так через превью нельзя достать другой файл Диска.
function insideLayoutsRoot(path, root) {
  const key = diskPathKey(path);
  return key.startsWith(`${diskPathKey(root)}/`) && !key.split('/').includes('..');
}

// Превью отдаёт сам Яндекс: токен уходит только на его адреса.
function isDiskPreviewUrl(url) {
  return /^https:\/\/([a-z0-9-]+\.)*(yandex\.ru|yandex\.net)\//.test(String(url || ''));
}

function previewCacheKey(path) {
  const key = `preview:${LAYOUT_PREVIEW_SIZE}:${diskPathKey(path)}`;
  return key.length <= 250 ? key : '';
}

// Ответ на layoutPreviews: { previews: { путь: 'data:image/…;base64,…' } }.
// Не больше LAYOUT_PREVIEW_BATCH путей за раз. Путь вне папки макетов или без превью — пустая строка.
function layoutPreviewsReply(request, role) {
  if (role !== 'admin') return { error: ADMIN_REQUIRED };
  const config = layoutsConfig();
  if (!config.token) return { error: LAYOUTS_NOT_CONFIGURED };
  const paths = (Array.isArray(request.paths) ? request.paths : [])
    .map(path => field(path, 500))
    .filter(Boolean)
    .slice(0, LAYOUT_PREVIEW_BATCH);
  try {
    return { ok: true, previews: layoutPreviews(paths, config.root, config.token) };
  } catch (error) {
    console.error(error);
    const reason = error.kind === 'auth' ? LAYOUT_ALERT_TEXT : error.message;
    return { error: { code: 'LAYOUT_PREVIEW_FAILED', message: `Не удалось загрузить превью макетов: ${reason}` } };
  }
}

// Сначала кэш, потом Диск: один пакет запросов за ссылками на превью, второй — за самими картинками.
function layoutPreviews(paths, root, token) {
  const cache = CacheService.getScriptCache();
  const previews = {};
  const wanted = [];
  paths.forEach(path => {
    if (Object.prototype.hasOwnProperty.call(previews, path)) return;
    previews[path] = '';
    if (!insideLayoutsRoot(path, root)) return;
    const key = previewCacheKey(path);
    const cached = key ? cache.get(key) : null;
    if (cached) previews[path] = cached;
    else wanted.push(path);
  });
  if (!wanted.length) return previews;

  const infos = diskFetchAll(wanted.map(path => diskRequestParams('get', '/resources', {
    path,
    preview_size: LAYOUT_PREVIEW_SIZE,
    preview_crop: 'false',
    fields: 'preview'
  })));
  const denied = infos.find(reply => reply.code === 401);
  if (denied) diskFail(denied, 'Превью макетов');
  const links = [];
  infos.forEach((reply, index) => {
    const url = reply.code === 200 ? String(reply.body.preview || '') : '';
    if (isDiskPreviewUrl(url)) links.push({ path: wanted[index], url });
  });
  if (!links.length) return previews;

  let responses;
  try {
    responses = UrlFetchApp.fetchAll(links.map(link => ({
      url: link.url,
      headers: { Authorization: `OAuth ${token}` },
      muteHttpExceptions: true
    })));
  } catch (error) {
    throw DiskError('retry', `Яндекс Диск недоступен: ${error.message}`);
  }
  responses.forEach((response, index) => {
    if (response.getResponseCode() !== 200) return;
    const blob = response.getBlob();
    const type = String(blob.getContentType() || '').split(';')[0].trim();
    if (!/^image\//.test(type)) return;
    const dataUrl = `data:${type};base64,${Utilities.base64Encode(blob.getBytes())}`;
    const path = links[index].path;
    previews[path] = dataUrl;
    const key = previewCacheKey(path);
    if (key && dataUrl.length <= LAYOUT_PREVIEW_CACHE_MAX) {
      try {
        cache.put(key, dataUrl, LAYOUT_PREVIEW_CACHE_S);
      } catch (error) {
        console.warn(`Превью ${path} не попало в кэш: ${error.message}`);
      }
    }
  });
  return previews;
}

// ───── Меню таблицы ─────

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('FB Print')
      .addItem('Собрать макеты для выделенной заявки', 'rebuildLayoutsForSelectedRow')
      .addItem('Собрать очередь макетов сейчас', 'buildLayoutsNow')
      .addToUi();
  } catch (error) {
    console.error(`Меню FB Print не добавлено: ${error.message}`);
  }
}

// Пункт меню: выделите строку заявки на листе «Заявки» — её макеты соберутся заново прямо сейчас.
function rebuildLayoutsForSelectedRow() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet || sheet.getName() !== ORDERS_SHEET) {
    ui.alert(`Выделите строку заявки на листе «${ORDERS_SHEET}».`);
    return;
  }
  const row = sheet.getActiveRange().getRow();
  const number = row >= 2 ? text(sheet.getRange(row, 1).getValue()) : '';
  if (!/^FB-\d+/.test(number)) {
    ui.alert('В выделенной строке нет номера заявки.');
    return;
  }
  if (!layoutsConfig().token) {
    ui.alert(LAYOUTS_NOT_CONFIGURED.message);
    return;
  }
  rebuildLayouts(number);
  ui.alert(layoutQueueSummary(runLayoutQueue({ deadline: Date.now() + LAYOUT_RUN_MS })));
}

// Пункт меню: собрать всё, что ждёт в очереди, не дожидаясь триггера.
function buildLayoutsNow() {
  SpreadsheetApp.getUi().alert(layoutQueueSummary(runLayoutQueue({ deadline: Date.now() + LAYOUT_RUN_MS })));
}

// ───── Колонка «Макет» на листах артикулов (запускают в редакторе) ─────

// Создаёт заголовок «Макет» в H2 на обоих листах артикулов (формат как у G2), если ячейка пуста.
// Если в H2 другой текст — пишет ошибку в журнал и лист не трогает.
// Возвращает имена листов, где колонка готова.
function setupLayoutColumn() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const ready = [];
  COMPANIES.forEach(company => {
    const sheet = spreadsheet.getSheetByName(company.sheet);
    if (!sheet) {
      console.error(`Нет листа «${company.sheet}» — колонка «${LAYOUT_HEADER}» не создана.`);
      return;
    }
    const header = sheet.getRange(2, LAYOUT_COLUMN);
    const value = text(header.getValue() ?? '');
    if (value && value !== LAYOUT_HEADER) {
      console.error(`«${company.sheet}»: в H2 уже стоит «${value}» — лист не изменён. Освободите колонку H и запустите снова.`);
      return;
    }
    if (!value) {
      sheet.getRange(2, LAYOUT_COLUMN - 1).copyTo(header, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      header.setValue(LAYOUT_HEADER);
      sheet.setColumnWidth(LAYOUT_COLUMN, 240);
      console.log(`«${company.sheet}»: добавлена колонка «${LAYOUT_HEADER}».`);
    }
    ready.push(company.sheet);
  });
  return ready;
}

// Заполняет ТОЛЬКО пустые ячейки H по правилу имени. Ручные значения не трогает никогда.
// Журнал: сколько заполнено; артикулы без файла; артикулы с несколькими файлами (и их имена) — их H остаётся пустой;
// значения H, файла для которых нет на Диске; файлы, которые не подошли ни одному артикулу.
function fillLayoutColumn() {
  const ready = setupLayoutColumn();
  const config = layoutsConfig();
  if (!config.token) {
    console.log('Не задан YANDEX_DISK_TOKEN — список макетов не получить.');
    return null;
  }
  if (config.error) {
    console.error(config.error);
    return null;
  }
  const files = listLayoutFiles(config.root, config.ordersRoot);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const articles = [];
  const sizes = {};
  COMPANIES.filter(company => ready.includes(company.sheet)).forEach(company => {
    const sheet = spreadsheet.getSheetByName(company.sheet);
    const count = sheet.getLastRow() - 2;
    if (count < 1) return;
    sizes[company.sheet] = count;
    sheet.getRange(3, 1, count, LAYOUT_COLUMN).getValues().forEach((row, index) => {
      const sku = text(row[2] ?? '');
      if (!sku) return;
      articles.push({
        sheet: company.sheet, row: index + 3, companyId: company.id, prefix: company.layoutPrefix,
        sku, layout: text(row[LAYOUT_COLUMN - 1] ?? '')
      });
    });
  });

  const plan = planLayoutFill(articles, files);
  let filled = 0;
  Object.keys(sizes).forEach(sheetName => {
    const fills = plan.fills.filter(item => item.sheet === sheetName);
    if (!fills.length) return;
    const range = spreadsheet.getSheetByName(sheetName).getRange(3, LAYOUT_COLUMN, sizes[sheetName], 1);
    const column = range.getValues();
    fills.forEach(item => {
      const cell = column[item.row - 3];
      if (cell && text(cell[0] ?? '') === '') {
        cell[0] = item.value;
        filled++;
      }
    });
    range.setValues(column);
  });

  console.log(`Файлов в папке макетов: ${files.length}. Заполнено ячеек «${LAYOUT_HEADER}»: ${filled}.`);
  if (plan.missing.length) console.log(`Нет файла (${plan.missing.length}): ${limitedList(plan.missing, 4000)}`);
  if (plan.conflicts.length) {
    console.log(`Несколько файлов, ячейка оставлена пустой (${plan.conflicts.length}):\n${plan.conflicts.map(item => `${item.label}: ${item.files.join(', ')}`).join('\n')}`);
  }
  if (plan.notFound.length) {
    console.log(`В колонке «${LAYOUT_HEADER}» файл, которого нет на Диске (${plan.notFound.length}):\n${plan.notFound.map(item => `${item.label}: «${item.value}»`).join('\n')}`);
  }
  if (plan.unusedFiles.length) console.log(`Файлы, которые не подошли ни одному артикулу (${plan.unusedFiles.length}): ${limitedList(plan.unusedFiles, 4000)}`);
  return { filled, missing: plan.missing, conflicts: plan.conflicts, notFound: plan.notFound, unusedFiles: plan.unusedFiles };
}

// Запустите один раз в редакторе после того, как добавили YANDEX_DISK_TOKEN:
// проверяет токен и папки, показывает примеры файлов, ставит ежечасный запуск очереди и заголовки F–H на «Заявках».
function setupLayouts() {
  const properties = PropertiesService.getScriptProperties();
  const admin = properties.getProperty('ADMIN_PASSWORD');
  if (!admin) console.warn('ADMIN_PASSWORD не задан — на сайте нет администратора: удалять заявки и собирать макеты заново некому.');
  else if (admin === properties.getProperty('ACCESS_PASSWORD')) console.warn('ADMIN_PASSWORD совпадает с ACCESS_PASSWORD — с таким паролем входят как клиент. Задайте другой пароль.');

  setupLayoutHeaders(ordersSheet());
  const config = layoutsConfig();
  if (!config.token) {
    console.log('Не задан YANDEX_DISK_TOKEN — сборка макетов выключена.');
    return;
  }
  if (config.error) {
    console.error(config.error);
    return;
  }

  const oneOff = properties.getProperty('LAYOUT_TRIGGER_ID');
  const hourly = ScriptApp.getProjectTriggers()
    .some(trigger => trigger.getHandlerFunction() === LAYOUT_HANDLER && trigger.getUniqueId() !== oneOff);
  if (!hourly) {
    ScriptApp.newTrigger(LAYOUT_HANDLER).timeBased().everyHours(1).create();
    console.log('Поставлен ежечасный запуск очереди макетов.');
  }

  const disk = diskRequest('get', '');
  if (disk.code !== 200) {
    console.error(`Яндекс Диск не принял токен: ответ ${disk.code}. Получите новый токен и замените YANDEX_DISK_TOKEN.`);
    return;
  }
  console.log('Токен Яндекс Диска принят.');
  const files = listLayoutFiles(config.root, config.ordersRoot);
  console.log(`Папка макетов ${config.root}: файлов ${files.length}. Примеры: ${files.slice(0, 20).map(file => file.name).join(', ')}`);
  ensureDiskFolder(config.ordersRoot);
  console.log(`Папки заявок создаются в ${config.ordersRoot}.`);
}
