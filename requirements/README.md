---
tags: [index]
aliases: [Требования, Оглавление требований]
---

# Требования к сайту FB Print

Здесь описано, что сайт делает сейчас. Это опора для переноса на Go и Angular: ни одна функция не должна потеряться, а одинаковые вещи на разных страницах должны вести себя одинаково.

Источник правды — текущий код: `index.html`, `js/`, `style.css`, `tokens.css`, `apps-script/Code.gs`, а также `README.md` и `API_CONTRACT.md`. Если требование расходится с кодом, прав код, пока требование не исправят.

План переезда: [platform-plan.md](../docs/platform-plan.md).

## Как устроена папка

| Папка | Что в ней |
| --- | --- |
| [pages/](pages/) | страницы и разделы сайта: что на них есть, в каком порядке, кто их видит |
| [components/](components/) | части страниц: поведение, состояния, тексты, клавиатура; `ui-*` — базовые элементы, общие для всего сайта |
| [rules/](rules/) | сквозные правила и процессы: расчёт цены, проверка каталога, роли, заявка, Excel, макеты, Telegram |
| [templates/](templates/) | шаблоны новых файлов |
| [glossary.md](glossary.md) | словарь терминов |
| [open-issues.md](open-issues.md) | все открытые вопросы и расхождения из файлов одним списком |
| `_tools/` | проверка папки; Obsidian её не показывает |

Порядок чтения: страница → её компоненты → правила, на которые они ссылаются.

Сейчас описано 1 472 требования. Открыто 80 вопросов и 117 расхождений: [open-issues.md](open-issues.md).

## Проверка

После правок запустите из корня репозитория:

```
node requirements/_tools/check.mjs
```

Команда ищет битые ссылки, вики-ссылки, повторы номеров и префиксов и пересобирает [open-issues.md](open-issues.md). Если нашлись ошибки, она их перечисляет и завершается с кодом 1.

## Правила оформления

**Ссылки.** Обычные Markdown-ссылки с относительным путём и расширением `.md`: `[Поиск артикула](../components/article-search.md)`. Такие ссылки работают в Obsidian, на GitHub и в редакторе кода. Вики-ссылки `[[…]]` не используем: GitHub их не понимает.

Настройка Obsidian: открыть как хранилище корень репозитория или папку `requirements`. В «Настройки → Файлы и ссылки»: «Формат новых ссылок» — «Относительный путь к файлу», «Использовать `[[Вики-ссылки]]`» — выключено.

**Имена файлов** — латиницей, через дефис: `order-table.md`. Название по-русски — в заголовке и в `aliases`, по нему файл ищется в Obsidian.

**Шапка файла** (frontmatter):

```yaml
---
tags: [page]            # page | component | ui | rule
aliases: [Расчёт]       # русские названия для поиска
prefix: CALC            # префикс номеров требований, уникальный
roles: [client, admin]  # кто видит
source: [index.html, js/calculator.js]   # где это в текущем коде
status: draft           # draft | reviewed | approved
---
```

**Номер требования** — `ПРЕФИКС-NN`, например `CALC-07`. Номер не меняется и не переиспользуется: удалённое требование помечается ~~зачёркнутым~~ с причиной. По номерам потом проверяется перенос и пишутся тесты.

**Формулировка требования** — одно поведение, проверяемое: «Если тираж меньше минимума, кнопка „Добавить в заявку“ недоступна». Не «удобный», «быстрый», «понятный».

**Тексты интерфейса** — дословно, в кавычках «ёлочках», как на сайте сейчас.

**Не повторять.** Правило, которое касается нескольких мест, описывается один раз в `rules/` или в компоненте, а остальные ссылаются на него. Страница не пересказывает компонент, а ссылается на него.

**Пометки:**

- `> [!question] Вопрос` — неясно, как должно быть; нужен ответ;
- `> [!warning] Расхождение` — код ведёт себя не так, как описано в README или контракте;
- `> [!note] При переносе` — что меняется при переезде на Go и Angular (по плану).

## Роли

- `client` — вход по клиентскому паролю;
- `admin` — вход по паролю администратора; видит всё, что клиент, и больше.

Подробно: [rules/access-and-roles.md](rules/access-and-roles.md).

## Оглавление

### Страницы

| Файл | Страница | Префикс | Роли |
| --- | --- | --- | --- |
| [shell.md](pages/shell.md) | Каркас: шапка, вкладки, загрузка, уведомления | `SHELL` | все |
| [login.md](pages/login.md) | Вход | `LOGIN` | все |
| [calculator.md](pages/calculator.md) | Расчёт | `CALC` | client, admin |
| [orders.md](pages/orders.md) | Заявки | `ORDERS` | client, admin |
| [articles.md](pages/articles.md) | Артикулы | `ARTS` | admin |
| [categories.md](pages/categories.md) | Категории | `CATS` | admin |

### Компоненты страниц

**Каркас и вход**

| Файл | Компонент | Префикс |
| --- | --- | --- |
| [site-header.md](components/site-header.md) | Шапка | `HDR` |
| [view-tabs.md](components/view-tabs.md) | Вкладки разделов | `TABS` |
| [data-status.md](components/data-status.md) | Статус данных и «Выйти» | `DSTAT` |
| [admin-badge.md](components/admin-badge.md) | Метка «Администратор» | `ABADGE` |
| [page-loader.md](components/page-loader.md) | Экран загрузки | `LOADER` |
| [login-dialog.md](components/login-dialog.md) | Окно входа | `LOGINDLG` |

**Расчёт: шаги**

| Файл | Компонент | Префикс |
| --- | --- | --- |
| [catalog-alert.md](components/catalog-alert.md) | Предупреждение об ошибке каталога | `CALERT` |
| [company-switch.md](components/company-switch.md) | Шаг 1: выбор компании | `COMP` |
| [article-search.md](components/article-search.md) | Шаг 2: поиск артикула | `ASRCH` |
| [selected-product.md](components/selected-product.md) | Карточка выбранного артикула | `PROD` |
| [quantity-control.md](components/quantity-control.md) | Поле тиража с «−» и «+» | `QTY` |
| [urgency-picker.md](components/urgency-picker.md) | Срок изготовления | `URG` |
| [condition-hint.md](components/condition-hint.md) | Подсказка о тираже | `COND` |
| [price-ticket.md](components/price-ticket.md) | Цена и «Добавить в заявку» | `PRICE` |

**Расчёт: заявка**

| Файл | Компонент | Префикс |
| --- | --- | --- |
| [order-panel.md](components/order-panel.md) | Панель заявки | `OPANEL` |
| [order-tools.md](components/order-tools.md) | Поиск, фильтры и сортировка заявки | `OTOOLS` |
| [order-table.md](components/order-table.md) | Таблица позиций | `OTABLE` |
| [order-pager.md](components/order-pager.md) | Страницы заявки | `OPAGER` |
| [order-footer.md](components/order-footer.md) | Итог, доставка, Excel, отправка | `OFOOT` |
| [order-dock.md](components/order-dock.md) | Итог внизу экрана | `ODOCK` |
| [submit-dialog.md](components/submit-dialog.md) | Окно отправки заявки | `SUBMIT` |
| [excel-import-zone.md](components/excel-import-zone.md) | Зона «Заявка из Excel» | `IMPZONE` |
| [import-review-dialog.md](components/import-review-dialog.md) | Окно «Проверка заявки» | `IMPREV` |

**Заявки**

| Файл | Компонент | Префикс |
| --- | --- | --- |
| [orders-toolbar.md](components/orders-toolbar.md) | Фильтр заявок и время обновления | `OTBAR` |
| [sent-order-card.md](components/sent-order-card.md) | Заявка в списке | `SORDER` |
| [order-lines.md](components/order-lines.md) | Позиции отправленной заявки | `OLINES` |
| [order-status-select.md](components/order-status-select.md) | Статус заявки (админ) | `OSTATUS` |
| [customer-email-dialog.md](components/customer-email-dialog.md) | Письмо заказчику (админ) | `CEMAIL` |
| [layout-bundle.md](components/layout-bundle.md) | Папка макетов заявки (админ) | `LBUNDLE` |

**Артикулы и категории (админ)**

| Файл | Компонент | Префикс |
| --- | --- | --- |
| [articles-toolbar.md](components/articles-toolbar.md) | Фильтры и поиск артикулов | `ATBAR` |
| [article-card.md](components/article-card.md) | Карточка артикула | `ACARD` |
| [article-dialog.md](components/article-dialog.md) | Окно артикула | `ADLG` |
| [layout-upload.md](components/layout-upload.md) | Загрузка макета | `LUPLOAD` |
| [layout-viewer.md](components/layout-viewer.md) | Просмотр макета крупно | `LVIEW` |
| [category-table.md](components/category-table.md) | Таблица категорий | `CTABLE` |
| [category-dialog.md](components/category-dialog.md) | Окно категории | `CDLG` |

### Базовые элементы

| Файл | Элемент | Префикс |
| --- | --- | --- |
| [ui-button.md](components/ui-button.md) | Кнопки | `BTN` |
| [ui-dialog.md](components/ui-dialog.md) | Модальное окно | `DLG` |
| [ui-confirm-dialog.md](components/ui-confirm-dialog.md) | Подтверждение удаления | `CONFIRM` |
| [ui-toast.md](components/ui-toast.md) | Уведомление | `TOAST` |
| [ui-form-field.md](components/ui-form-field.md) | Поле формы и ошибка | `FIELD` |
| [ui-search-field.md](components/ui-search-field.md) | Поле поиска | `SEARCH` |
| [ui-segmented-filter.md](components/ui-segmented-filter.md) | Переключатель-фильтр со счётчиком | `SEG` |
| [ui-empty-state.md](components/ui-empty-state.md) | Пустое состояние и «ничего не найдено» | `EMPTY` |
| [ui-spinner.md](components/ui-spinner.md) | Индикаторы загрузки | `SPIN` |
| [ui-tokens.md](components/ui-tokens.md) | Дизайн-токены и адаптивность | `TOKENS` |

### Правила и процессы

| Файл | Правило | Префикс |
| --- | --- | --- |
| [access-and-roles.md](rules/access-and-roles.md) | Пароли, роли, выход | `ACCESS` |
| [api-and-errors.md](rules/api-and-errors.md) | Запросы к API, тайм-ауты, ошибки, демо-режим | `API` |
| [site-version.md](rules/site-version.md) | Версия сайта и обновление | `VER` |
| [formatting.md](rules/formatting.md) | Числа, деньги, склонение, «е/ё» | `FMT` |
| [catalog-validation.md](rules/catalog-validation.md) | Проверка каталога | `CATVAL` |
| [pricing.md](rules/pricing.md) | Тираж и цена | `PRICING` |
| [order-draft.md](rules/order-draft.md) | Черновик заявки: хранение, вкладки, пересчёт | `DRAFT` |
| [order-submission.md](rules/order-submission.md) | Отправка заявки: проверки, повтор, номер | `OSEND` |
| [excel-import.md](rules/excel-import.md) | Разбор Excel клиента | `XLSIN` |
| [excel-export.md](rules/excel-export.md) | Формат Excel заявки | `XLSOUT` |
| [telegram.md](rules/telegram.md) | Сообщения в Telegram | `TG` |
| [layouts.md](rules/layouts.md) | Макеты: выбор файла, имена, папка заявки, превью | `LAYOUT` |
| [category-formulas.md](rules/category-formulas.md) | Формулы категории: срочная цена, кратность, сниженный тираж | `CFORM` |

### Прочее

- [glossary.md](glossary.md) — словарь
- [open-issues.md](open-issues.md) — открытые вопросы и расхождения
- [templates/page.md](templates/page.md), [templates/component.md](templates/component.md), [templates/rule.md](templates/rule.md) — шаблоны
