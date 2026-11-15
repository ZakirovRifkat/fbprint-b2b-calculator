// Гонка: администратор жмёт «Пересобрать папку», пока эта же заявка собирается.
// Правильное поведение: пересборка не теряется — после текущей сборки заявка снова в очереди
// (или пересобрана в этом же запуске), а свежая сборка копирует файлы заново.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_PASSWORDS, loadCodeGs } from './gas-harness.js';

const LAYOUTS = ['ГФ_10165_3_80x120.jpg', 'ГФ_10338_D80.jpg'];

test('«Пересобрать папку» во время сборки той же заявки не теряется', () => {
  const h = loadCodeGs({ layouts: LAYOUTS });
  const sent = h.order([['Глобал Фуд', '10165'], ['Глобал Фуд', '10338']]);

  let pressedAt = -1;
  h.disk.onCopy = () => {
    if (pressedAt >= 0) return;
    pressedAt = h.disk.requests.length;
    const reply = h.call({ action: 'rebuildLayouts', password: TEST_PASSWORDS.admin, number: sent.number });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.equal(h.layoutCells(sent.number).status, 'В очереди');
  };

  h.runQueue();
  assert.ok(pressedAt >= 0, 'кнопку нажали во время копирования');

  const copiedAfterPress = h.disk.requests.slice(pressedAt).filter(r => r.kind === 'copy').length;
  const status = h.layoutCells(sent.number).status;
  // Копия, на которой нажали, и вторая копия той же пачки — старая сборка; новая добавит ещё две.
  // Сразу после запуска: либо пересобрано в этом же запуске (копии после нажатия), либо заявка ждёт в очереди.
  assert.ok(copiedAfterPress >= 3 || status === 'В очереди',
    `пересборка потеряна: после запуска G = «${status}», копий после нажатия ${copiedAfterPress}, LAYOUT_FRESH = ${h.props.LAYOUT_FRESH}`);

  // И в итоге (ещё один запуск по триггеру) файлы действительно скопированы заново.
  h.runQueue();
  const copiesAfter = h.disk.requests.slice(pressedAt).filter(r => r.kind === 'copy').length;
  assert.ok(copiesAfter >= 3, `после нажатия скопировано ${copiesAfter} файлов вместо новой сборки`);
  assert.equal(h.layoutCells(sent.number).status, 'Готово');
});
