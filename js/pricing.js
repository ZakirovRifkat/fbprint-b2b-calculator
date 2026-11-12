// Правила тиража и цены: минимум, кратность, сниженный тираж, срочность.
import { $, integer, money, roundMoney } from './format.js';

export const searchLimit = 6;
export const freeDeliveryFrom = 100000;
export const urgencyLabels = {
  standard: 'Стандартный',
  urgent: 'Срочный',
  emergency: 'Экстренный'
};
export const conditionLabels = {
  good: 'Тираж подходит',
  multiple: 'Тираж не кратен',
  reduced: 'Сниженный тираж'
};

// Наименьший тираж по обычной цене: минимум, приведённый к кратности.
export function minimumValid(category) {
  return Math.ceil(category.minimumQuantity / category.multiple) * category.multiple;
}

// Три зоны тиража:
// 1) меньше «Сниженное кол-во от» (или минимума, если сниженного нет) — не принимаем;
// 2) сниженный тираж — цена «Стоимость сниженного тиража», только стандартный срок,
//    любое количество в диапазоне, кратность не проверяется;
// 3) от минимума — цена по срочности, кратность категории.
export function quote(value, category, urgency) {
  const reduced = category.reducedRun;
  const minimum = minimumValid(category);
  const standard = category.prices.standard;

  if (value < (reduced ? reduced.minQuantity : category.minimumQuantity)
    || (reduced && value > reduced.maxQuantity && value < category.minimumQuantity)) {
    return {
      status: 'blocked',
      tone: 'danger',
      title: 'Тираж меньше минимального заказа',
      message: `Минимальный заказ — ${integer.format(reduced && value < reduced.minQuantity ? reduced.minQuantity : minimum)} шт.`,
      suggested: reduced && value < reduced.minQuantity ? reduced.minQuantity : minimum,
      canAdd: false,
      urgency: 'standard',
      unitPrice: null
    };
  }

  if (value < category.minimumQuantity) {
    // Клиенты сравнивают цену за штуку: выгода — сколько экономит каждая штука от минимума.
    const saving = roundMoney(reduced.price - standard);
    return {
      urgency: 'standard',
      unitPrice: reduced.price,
      canAdd: true,
      tone: 'warning',
      status: 'reduced',
      title: 'Сниженный тираж',
      message: `От ${integer.format(minimum)} шт. — ${money.format(standard)} за штуку.`,
      benefit: saving > 0
        ? `Экономия ${money.format(saving)} на каждой штуке (−${Math.round(saving / reduced.price * 100)}%)`
        : null,
      suggested: minimum
    };
  }

  const base = { urgency, unitPrice: category.prices[urgency], canAdd: true };
  if (value % category.multiple !== 0) {
    const next = Math.ceil(value / category.multiple) * category.multiple;
    return {
      ...base,
      status: 'multiple',
      tone: 'warning',
      title: `Тираж не кратен ${integer.format(category.multiple)}`,
      message: `Тираж должен делиться на ${integer.format(category.multiple)}. Ближайший подходящий — ${integer.format(next)} шт.`,
      suggested: next
    };
  }
  return {
    ...base,
    status: 'good',
    tone: 'good',
    title: 'Тираж подходит',
    message: `Не меньше минимума и делится на ${integer.format(category.multiple)}.`,
    suggested: null
  };
}

// Шаг кнопок «−» и «+»: в сниженном тираже — по «от», дальше — по кратности категории.
export function stepQuantity(value, category, direction) {
  const reduced = category.reducedRun;
  const minimum = minimumValid(category);
  if (direction > 0) {
    if (reduced && value < category.minimumQuantity) {
      const next = (Math.floor(value / reduced.minQuantity) + 1) * reduced.minQuantity;
      return next > reduced.maxQuantity ? minimum : next;
    }
    return Math.max(minimum, (Math.floor(value / category.multiple) + 1) * category.multiple);
  }
  if (value > minimum) return Math.max(minimum, (Math.ceil(value / category.multiple) - 1) * category.multiple);
  if (!reduced) return minimum;
  const below = Math.min(value, reduced.maxQuantity + 1);
  return Math.max(reduced.minQuantity, (Math.ceil(below / reduced.minQuantity) - 1) * reduced.minQuantity);
}
