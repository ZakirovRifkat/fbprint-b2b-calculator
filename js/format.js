// Общие помощники: поиск элемента, форматы чисел и денег, склонение, подгонка крупных сумм.

export const $ = selector => document.querySelector(selector);
export const money = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 4
});
export const integer = new Intl.NumberFormat('ru-RU');

// Формулы таблицы дают доли копейки (0,75 × 1,5 = 1,125), а таблица показывает 1,13 ₽.
// toFixed убирает хвосты двоичной арифметики: 1,425 × 100 = 142,49999999999997.
export function roundMoney(value) {
  return Math.round(Number((value * 100).toFixed(6))) / 100;
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function plural(value, one, few, many) {
  const last = value % 10;
  const lastTwo = value % 100;
  return last === 1 && lastTwo !== 11
    ? one
    : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)
      ? few
      : many;
}

// Суммы от 100 000 ₽ не помещаются крупным шрифтом: уменьшаем, пока строка не влезет.
export function fitText(element) {
  element.style.fontSize = '';
  let size = parseFloat(getComputedStyle(element).fontSize);
  while (element.scrollWidth > element.clientWidth && size > 16) {
    size -= 1;
    element.style.fontSize = `${size}px`;
  }
}

export function cell(tag, text, name) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (name) node.dataset.cell = name;
  return node;
}
