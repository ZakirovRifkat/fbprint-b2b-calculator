// Шаги 1–3: компания, поиск артикула, тираж и добавление в заявку.
import { state } from './state.js';
import { $, fitText, integer, money, roundMoney } from './format.js';
import { minimumValid, quote, searchLimit } from './pricing.js';
import { categories } from './catalog.js';
import { makeLine, renderOrder, showLine } from './order.js';
import { toast } from './toast.js';

export function selectCompany(nextCompanyId) {
  state.companyId = nextCompanyId;
  state.article = null;
  $('#article-search').value = '';
  renderCompanies();
  renderSelected();
  renderSearch('');
  $('#article-search').focus();
}

export function renderCompanies() {
  const root = $('#company-switch');
  root.innerHTML = '';
  state.data.companies.forEach(company => {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'radio';
    button.ariaChecked = String(company.id === state.companyId);
    button.textContent = company.name;
    button.addEventListener('click', () => selectCompany(company.id));
    root.append(button);
  });
}

// В названиях встречаются и «Ё», и «Е»: «КОПЧЁНОСТЯМИ» и «КОПЧЕНОСТЯМИ».
export function searchKey(value) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

export function matchingArticles(query = '') {
  const normalized = searchKey(query.trim());
  return state.data.articles.filter(item => {
    if (item.companyId !== state.companyId) return false;
    if (!normalized) return true;
    return searchKey(item.sku).includes(normalized) || searchKey(item.name).includes(normalized);
  });
}

export function hideSearch() {
  $('#search-results').hidden = true;
  $('#article-search').ariaExpanded = 'false';
}

export function renderSearch(query) {
  const root = $('#search-results');
  // Пустой запрос: варианты показываем, только пока поле в фокусе, — иначе список не нужен.
  if (!query.trim() && document.activeElement !== $('#article-search')) {
    root.innerHTML = '';
    hideSearch();
    return;
  }

  const categoryMap = categories();
  const matches = matchingArticles(query);
  const items = matches.slice(0, searchLimit);
  root.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.role = 'status';
    empty.textContent = 'Ничего не найдено. Проверьте номер или название.';
    root.append(empty);
  }

  items.forEach(item => {
    const category = categoryMap.get(item.categoryId);
    const button = document.createElement('button');
    const sku = document.createElement('strong');
    const name = document.createElement('span');
    const size = document.createElement('small');
    button.type = 'button';
    button.className = 'result-button';
    button.role = 'option';
    sku.textContent = item.sku;
    name.textContent = item.name;
    size.textContent = inOrder(item) ? 'Уже в заявке' : category?.size ?? '';
    button.disabled = inOrder(item);
    button.append(sku, name, size);
    button.addEventListener('click', () => selectArticle(item));
    root.append(button);
  });

  if (matches.length > items.length) {
    const more = document.createElement('div');
    more.className = 'search-more';
    more.textContent = query.trim()
      ? `Показаны ${items.length} из ${matches.length}. Уточните номер или название.`
      : `Показаны ${items.length} из ${matches.length}. Начните вводить номер или название.`;
    root.append(more);
  }

  root.hidden = false;
  $('#article-search').ariaExpanded = 'true';
}

// Один артикул — одна позиция: повторно его не выбрать и не добавить.
export function lineKey(item) {
  return `${item.companyId}/${item.sku}`;
}

export function inOrder(item) {
  return state.order.some(line => line.key === lineKey(item));
}

export function selectArticle(nextArticle) {
  if (inOrder(nextArticle)) {
    toast('Этот артикул уже в заявке, тираж меняется там.');
    return;
  }
  state.article = nextArticle;
  $('#article-search').value = '';
  hideSearch();
  renderSelected();
  $('#quantity').focus();
}

export function setCalculationDisabled(disabled) {
  $('#calculation-block').ariaDisabled = String(disabled);
  $('.urgency').disabled = disabled;
  $('#quantity').disabled = disabled;
  $('#quantity-minus').disabled = disabled;
  $('#quantity-plus').disabled = disabled;
}

export function renderSelected({ resetQuantity = true } = {}) {
  const product = $('#selected-product');
  if (!state.article) {
    product.hidden = true;
    $('#quantity').value = '';
    $('#quantity').placeholder = '';
    setCalculationDisabled(true);
    renderCalculation();
    return;
  }

  const category = categories().get(state.article.categoryId);
  const company = state.data.companies.find(item => item.id === state.article.companyId);
  product.hidden = false;
  $('#product-company').textContent = company.name;
  $('#product-sku').textContent = state.article.sku;
  $('#product-name').textContent = state.article.name;
  $('#product-size').textContent = category.size;
  $('#product-color').textContent = category.color;
  setCalculationDisabled(false);
  // При выборе артикула — минимальный тираж; без артикула поле пустое.
  if (resetQuantity) setQuantity(minimumValid(category));
  $('#quantity').placeholder = `от ${integer.format(category.reducedRun?.minQuantity ?? minimumValid(category))}`;
  renderCalculation();
}

export function setQuantity(value) {
  $('#quantity').value = value ? integer.format(value) : '';
}

export function quantity() {
  return Math.max(0, Number(String($('#quantity').value).replace(/\D/g, '')) || 0);
}

export function selectedUrgency() {
  return document.querySelector('[name=urgency]:checked')?.value ?? 'standard';
}

// Артикул выбран, количество ещё не введено: нейтральная подсказка без цены.
export function renderEmptyQuantity(category) {
  const lowest = category.reducedRun?.minQuantity ?? minimumValid(category);
  document.querySelectorAll('[name=urgency]').forEach(input => {
    input.disabled = false;
  });
  $('#urgency-note').hidden = true;
  $('#condition').dataset.state = 'idle';
  $('#condition-title').textContent = 'Укажите тираж';
  $('#condition-message').textContent = `Минимальный заказ — ${integer.format(lowest)} шт.`;
  $('#condition-benefit').hidden = true;
  $('#apply-suggestion').hidden = true;
  $('#unit-price').textContent = '—';
  fitText($('#unit-price'));
  $('#line-quantity').textContent = '0 шт.';
  $('#line-total').textContent = '—';
  $('#minimum-value').textContent = `${integer.format(category.minimumQuantity)} шт.`;
  $('#multiple-value').textContent = `${integer.format(category.multiple)} шт.`;
  $('#reduced-value').textContent = category.reducedRun
    ? `${integer.format(category.reducedRun.minQuantity)}–${integer.format(category.reducedRun.maxQuantity)} шт.`
    : 'нет';
  $('#add-line').disabled = inOrder(state.article);
  $('#add-line').textContent = inOrder(state.article) ? 'Уже в заявке' : 'Добавить в заявку';
}

// Срочный и экстренный заказ — только от минимального тиража.
export function syncUrgency(value, category) {
  const onlyStandard = value < category.minimumQuantity;
  document.querySelectorAll('[name=urgency]').forEach(input => {
    input.disabled = onlyStandard && input.value !== 'standard';
    if (input.disabled && input.checked) $('[name=urgency][value=standard]').checked = true;
  });
  // Почему срок недоступен — строкой под группой: на телефоне наведения нет.
  $('#urgency-note').hidden = !onlyStandard;
  $('#urgency-note').textContent = `Срочный и экстренный заказ — от ${integer.format(minimumValid(category))} шт.`;
}

export function renderCalculation() {
  const condition = $('#condition');
  const apply = $('#apply-suggestion');
  if (!state.article) {
    condition.dataset.state = 'idle';
    $('#urgency-note').hidden = true;
    $('#condition-benefit').hidden = true;
    $('#condition-title').textContent = 'Выберите артикул';
    $('#condition-message').textContent = 'После выбора появятся условия тиража.';
    apply.hidden = true;
    $('#line-total').textContent = '—';
    $('#line-quantity').textContent = '0 шт.';
    $('#unit-price').textContent = '—';
    $('#minimum-value').textContent = '—';
    $('#multiple-value').textContent = '—';
    $('#reduced-value').textContent = '—';
    $('#add-line').disabled = false;
    $('#add-line').textContent = 'Добавить в заявку';
    return;
  }

  const category = categories().get(state.article.categoryId);
  const value = quantity();
  if (!value) {
    renderEmptyQuantity(category);
    return;
  }
  syncUrgency(value, category);
  const result = quote(value, category, selectedUrgency());
  condition.dataset.state = result.tone;
  $('#condition-benefit').hidden = !result.benefit;
  $('#condition-benefit').textContent = result.benefit ?? '';
  $('#condition-title').textContent = result.title;
  $('#condition-message').textContent = result.message;
  apply.hidden = !result.suggested;
  if (result.suggested) {
    apply.textContent = `Применить ${integer.format(result.suggested)}`;
    apply.onclick = () => {
      setQuantity(result.suggested);
      renderCalculation();
    };
  }
  // Клиенты сравнивают цену за штуку, поэтому крупно — она, а сумма позиции — мелко.
  $('#unit-price').textContent = result.canAdd ? money.format(result.unitPrice) : '—';
  fitText($('#unit-price'));
  $('#line-quantity').textContent = `${integer.format(value)} шт.`;
  $('#line-total').textContent = result.canAdd ? money.format(roundMoney(value * result.unitPrice)) : '—';
  $('#minimum-value').textContent = `${integer.format(category.minimumQuantity)} шт.`;
  $('#multiple-value').textContent = `${integer.format(category.multiple)} шт.`;
  $('#reduced-value').textContent = category.reducedRun
    ? `${integer.format(category.reducedRun.minQuantity)}–${integer.format(category.reducedRun.maxQuantity)} шт.`
    : 'нет';
  const added = inOrder(state.article);
  $('#add-line').disabled = added;
  $('#add-line').textContent = added ? 'Уже в заявке' : 'Добавить в заявку';
}

export function addLine() {
  if (!state.article) {
    toast('Сначала выберите артикул.');
    $('#article-search').focus();
    return;
  }
  const category = categories().get(state.article.categoryId);
  const value = quantity();
  if (!value) {
    toast('Укажите тираж.');
    $('#quantity').focus();
    return;
  }
  const result = quote(value, category, selectedUrgency());
  if (!result.canAdd) {
    toast(result.message);
    $('#quantity').focus();
    return;
  }
  if (inOrder(state.article)) {
    toast('Этот артикул уже в заявке.');
    return;
  }

  const line = makeLine(state.article, value, result);
  state.order.push(line);
  showLine(line);
  renderOrder();
  toast({
    good: 'Позиция добавлена в заявку.',
    reduced: 'Позиция добавлена по цене сниженного тиража.'
  }[result.status] ?? 'Позиция добавлена. Проверьте условия тиража.');
}
