// js/articles.js: тексты проблем, фильтры и счётчики вкладки «Артикулы», запросы к Apps Script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDocument } from './fake-dom.js';
import { memoryStorage, setStorage } from './helpers.js';

installFakeDocument();
const { articleCounts, articleLayoutsRequest, filterArticles, hasLayout, layoutPreviewsRequest, problemText, PREVIEW_BATCH } =
  await import('../js/articles.js');

const ok = (companyId, sku, name, layout) => ({ companyId, sku, name, layout, path: `disk:/r/${layout}`, url: 'https://disk.yandex.ru/client/disk/r', problem: '', candidates: [] });
const bad = (companyId, sku, name, problem, candidates = []) => ({ companyId, sku, name, layout: '', path: '', url: '', problem, candidates });

const LIST = [
  ok('global_food', '10165', 'Грудка куриная с картофелем', 'ГФ_10165_3_80x120.jpg'),
  ok('global_food', '15053', 'Стикер время для лисичек', 'ГФ_15053_D35.jpg'),
  bad('global_food', '13470', 'Щи из свежей капусты', 'missing'),
  ok('studio_vkusa', '15053', 'Стикер время для лисичек', 'ГФ_15053_D35.jpg'),
  bad('studio_vkusa', '15867', 'Салат крабовый', 'conflict', ['ГФ_15867_2_70x80.jpg', 'СВ_15867_60x230.jpg'])
];

test('problemText: понятная причина для каждой проблемы, у макета без проблем — пусто', () => {
  assert.equal(problemText(LIST[0]), '');
  assert.equal(problemText(LIST[2]), 'На Диске нет файла с этим артикулом');
  assert.equal(problemText(LIST[4]), 'На Диске несколько файлов: ГФ_15867_2_70x80.jpg, СВ_15867_60x230.jpg. Впишите нужный в колонку «Макет»');
  assert.equal(problemText(bad('global_food', '10338', '', 'notFound', ['ГФ_10338_old.jpg'])),
    'В колонке «Макет» указан «ГФ_10338_old.jpg», но такого файла на Диске нет');
  assert.equal(hasLayout(LIST[0]), true);
  assert.equal(hasLayout(LIST[2]), false);
});

test('filterArticles: компания, только без макета, поиск по артикулу, названию и файлу', () => {
  const skus = options => filterArticles(LIST, options).map(a => `${a.companyId}/${a.sku}`);
  assert.equal(filterArticles(LIST).length, 5);
  assert.deepEqual(skus({ company: 'studio_vkusa' }), ['studio_vkusa/15053', 'studio_vkusa/15867']);
  assert.deepEqual(skus({ missing: true }), ['global_food/13470', 'studio_vkusa/15867']);
  assert.deepEqual(skus({ query: '1505' }), ['global_food/15053', 'studio_vkusa/15053']);
  assert.deepEqual(skus({ query: 'ЛИСИЧЕК студ' }), []);
  assert.deepEqual(skus({ query: 'щи свежей' }), ['global_food/13470']);
  assert.deepEqual(skus({ query: 'D35', company: 'global_food' }), ['global_food/15053']);
  assert.deepEqual(filterArticles(null), []);
});

test('articleCounts: по компаниям и без макета в выбранной компании', () => {
  assert.deepEqual(articleCounts(LIST), { byCompany: { all: 5, global_food: 3, studio_vkusa: 2 }, missing: 2 });
  assert.equal(articleCounts(LIST, 'global_food').missing, 1);
  assert.deepEqual(articleCounts(undefined), { byCompany: { all: 0 }, missing: 0 });
});

test('запросы: articleLayouts и layoutPreviews уходят с паролем и путями', async () => {
  const requests = [];
  const local = memoryStorage();
  local.setItem('fbprint-access-password', 'admin-test-pass');
  setStorage('localStorage', local);
  setStorage('sessionStorage', memoryStorage());
  globalThis.window = { FBPRINT_CONFIG: { apiUrl: 'https://script.example.test/exec' } };
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { json: async () => ({ ok: true, articles: [], previews: {} }) };
  };
  await articleLayoutsRequest();
  await layoutPreviewsRequest(['disk:/r/a.jpg']);
  assert.deepEqual(requests.map(r => r.action), ['articleLayouts', 'layoutPreviews']);
  assert.deepEqual(requests[1].paths, ['disk:/r/a.jpg']);
  assert.equal(requests[0].password, 'admin-test-pass');
  assert.equal(PREVIEW_BATCH, 12);
});

test('articleSavePayload: новый артикул — компания из формы; правка — строка, прежний артикул и компания строки', async () => {
  const { articleSavePayload, sheetSize } = await import('../js/articles.js');
  const form = { company: 'studio_vkusa', category: '27', sku: ' 30001 ', size: '80 х 120', color: 'Цветная', name: ' ЭТИКЕТКА ', run: '500', layout: '' };
  assert.deepEqual(articleSavePayload(form), {
    company: 'studio_vkusa',
    article: { category: '27', sku: '30001', size: '80 х 120', color: 'Цветная', name: 'ЭТИКЕТКА', layout: '' }
  });
  const edited = articleSavePayload({ ...form, company: '' }, { companyId: 'global_food', row: 14, sku: '19743' });
  assert.equal(edited.company, 'global_food');
  assert.equal(edited.row, 14);
  assert.equal(edited.originalSku, '19743');
  assert.equal(sheetSize('80 × 120'), '80 х 120');
  assert.equal(sheetSize('40,5×95,6'), '40,5 х 95,6');
});

test('layoutFileProblem: JPG, PNG и PDF до 20 МБ; тип берётся и по расширению', async () => {
  const { layoutFileProblem, layoutFileType } = await import('../js/articles.js');
  assert.equal(layoutFileProblem({ name: 'a.jpg', type: 'image/jpeg', size: 10 }), '');
  assert.equal(layoutFileType({ name: 'макет.PDF', type: '', size: 10 }), 'application/pdf');
  assert.equal(layoutFileType({ name: 'a.jpeg', type: '' }), 'image/jpeg');
  assert.equal(layoutFileProblem({ name: 'a.gif', type: 'image/gif', size: 10 }), 'Макет должен быть JPG, PNG или PDF');
  assert.equal(layoutFileProblem({ name: 'a.png', type: 'image/png', size: 0 }), 'Файл пустой');
  assert.equal(layoutFileProblem({ name: 'a.png', type: 'image/png', size: 21 * 1024 * 1024 }), 'Файл больше 20 МБ');
  assert.equal(layoutFileProblem(null), 'Файл не выбран');
});
