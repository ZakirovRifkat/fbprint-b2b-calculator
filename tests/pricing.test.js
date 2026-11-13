import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minimumValid, quote, stepQuantity } from '../js/pricing.js';

// Как категория 1 демо-каталога: сниженный тираж 1000–3999, дальше от 4000 кратно 4000.
const withReduced = {
  minimumQuantity: 4000,
  multiple: 4000,
  prices: { standard: 1, urgent: 1.5, emergency: 2 },
  reducedRun: { minQuantity: 1000, maxQuantity: 3999, price: 1.4 }
};

// Как категория 3: без сниженного тиража, минимум 5000, кратность 2500.
const withoutReduced = {
  minimumQuantity: 5000,
  multiple: 2500,
  prices: { standard: 2, urgent: 3, emergency: 4 },
  reducedRun: null
};

test('minimumValid приводит минимум к кратности', () => {
  assert.equal(minimumValid(withReduced), 4000);
  assert.equal(minimumValid(withoutReduced), 5000);
  assert.equal(minimumValid({ minimumQuantity: 5000, multiple: 3000 }), 6000);
});

test('тираж меньше сниженного не принимается', () => {
  const result = quote(500, withReduced, 'urgent');
  assert.equal(result.status, 'blocked');
  assert.equal(result.canAdd, false);
  assert.equal(result.unitPrice, null);
  assert.equal(result.suggested, 1000);
});

test('без сниженного тиража меньше минимума не принимается', () => {
  const result = quote(4000, withoutReduced, 'standard');
  assert.equal(result.status, 'blocked');
  assert.equal(result.suggested, 5000);
});

test('провал между сниженным тиражом и минимумом не принимается', () => {
  const gap = { ...withReduced, reducedRun: { minQuantity: 1000, maxQuantity: 2999, price: 1.4 } };
  const result = quote(3500, gap, 'standard');
  assert.equal(result.status, 'blocked');
  assert.equal(result.suggested, 4000);
});

test('сниженный тираж — своя цена и только стандартный срок', () => {
  const result = quote(2000, withReduced, 'emergency');
  assert.equal(result.status, 'reduced');
  assert.equal(result.canAdd, true);
  assert.equal(result.urgency, 'standard');
  assert.equal(result.unitPrice, 1.4);
  assert.equal(result.suggested, 4000);
  assert.match(result.benefit, /−29%/);
});

test('сниженный тираж не обещает экономию, если её нет', () => {
  const same = { ...withReduced, reducedRun: { ...withReduced.reducedRun, price: 1 } };
  assert.equal(quote(2000, same, 'standard').benefit, null);
});

test('кратность в сниженном тираже не проверяется', () => {
  assert.equal(quote(1234, withReduced, 'standard').status, 'reduced');
});

test('тираж от минимума — цена по выбранной срочности', () => {
  assert.equal(quote(4000, withReduced, 'standard').unitPrice, 1);
  assert.equal(quote(4000, withReduced, 'urgent').unitPrice, 1.5);
  const result = quote(8000, withReduced, 'emergency');
  assert.equal(result.status, 'good');
  assert.equal(result.urgency, 'emergency');
  assert.equal(result.unitPrice, 2);
  assert.equal(result.suggested, null);
});

test('некратный тираж принимается с подсказкой ближайшего', () => {
  const result = quote(6000, withReduced, 'urgent');
  assert.equal(result.status, 'multiple');
  assert.equal(result.canAdd, true);
  assert.equal(result.unitPrice, 1.5);
  assert.equal(result.suggested, 8000);
  assert.equal(quote(7000, withoutReduced, 'standard').suggested, 7500);
});

test('«+» в сниженном тираже идёт шагом «от», потом к минимуму', () => {
  assert.equal(stepQuantity(1000, withReduced, 1), 2000);
  assert.equal(stepQuantity(2500, withReduced, 1), 3000);
  assert.equal(stepQuantity(3000, withReduced, 1), 4000);
});

test('«+» от минимума идёт по кратности', () => {
  assert.equal(stepQuantity(4000, withReduced, 1), 8000);
  assert.equal(stepQuantity(5000, withReduced, 1), 8000);
  assert.equal(stepQuantity(0, withoutReduced, 1), 5000);
  assert.equal(stepQuantity(5000, withoutReduced, 1), 7500);
});

test('«−» не опускается ниже минимума, а дальше — в сниженный тираж', () => {
  assert.equal(stepQuantity(8000, withReduced, -1), 4000);
  assert.equal(stepQuantity(6000, withReduced, -1), 4000);
  assert.equal(stepQuantity(4000, withReduced, -1), 3000);
  assert.equal(stepQuantity(2500, withReduced, -1), 2000);
  assert.equal(stepQuantity(1000, withReduced, -1), 1000);
});

test('«−» без сниженного тиража останавливается на минимуме', () => {
  assert.equal(stepQuantity(7500, withoutReduced, -1), 5000);
  assert.equal(stepQuantity(5000, withoutReduced, -1), 5000);
  assert.equal(stepQuantity(100, withoutReduced, -1), 5000);
});
