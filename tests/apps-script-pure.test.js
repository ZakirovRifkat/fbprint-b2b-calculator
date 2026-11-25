// Чистые функции Code.gs: роль по паролю, правило имени макета, план копирования, тексты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGs, plain } from './gas-harness.js';

const h = loadCodeGs();
const c = h.ctx;
const { COMPANIES, LAYOUT_STATUS } = h.consts;

const file = name => ({ name, path: `disk:/r/${name}` });
const REAL_NAMES = ['ГФ_10165_3_80x120.jpg', 'ГФ_10167_2_60x100.jpg', 'ГФ_10168_2_60x100.jpg', 'ГФ_10338_D80.jpg', 'ГФ_10347_40x90.jpg', 'ГФ_10350_60x70.jpg'];

test('passwordRole: админ, клиент, чужой, пустой, не строка', () => {
  assert.equal(c.passwordRole('adm', 'cli', 'adm'), 'admin');
  assert.equal(c.passwordRole('cli', 'cli', 'adm'), 'client');
  assert.equal(c.passwordRole('nope', 'cli', 'adm'), null);
  assert.equal(c.passwordRole('', 'cli', 'adm'), null);
  assert.equal(c.passwordRole(undefined, 'cli', 'adm'), null);
  assert.equal(c.passwordRole(12345, '12345', 'adm'), null);
  assert.equal(c.passwordRole(['adm'], 'cli', 'adm'), null);
});

test('passwordRole: ADMIN_PASSWORD, равный ACCESS_PASSWORD, админом не делает', () => {
  assert.equal(c.passwordRole('same', 'same', 'same'), 'client');
});

test('passwordRole: задан только один пароль', () => {
  assert.equal(c.passwordRole('adm', null, 'adm'), 'admin');
  assert.equal(c.passwordRole('adm', '', 'adm'), 'admin');
  assert.equal(c.passwordRole('cli', 'cli', null), 'client');
  assert.equal(c.passwordRole('', null, 'adm'), null);
});

test('fileStem и layoutKey', () => {
  assert.equal(c.fileStem('ГФ_10165_3_80x120.jpg'), 'ГФ_10165_3_80x120');
  assert.equal(c.fileStem('.hidden'), '.hidden');
  assert.equal(c.fileStem('a.b.jpg'), 'a.b');
  assert.equal(c.fileStem('noext'), 'noext');
  assert.equal(c.layoutKey(' Ёлка '), 'елка');
  assert.equal(c.layoutKey(null), '');
  assert.equal(c.layoutKey(10165), '10165');
});

test('parseLayoutName на настоящих именах файлов', () => {
  const skus = ['10165', '10167', '10168', '10338', '10347', '10350'];
  REAL_NAMES.forEach((name, index) => {
    assert.deepEqual(plain(c.parseLayoutName(name)), { prefix: 'ГФ', sku: skus[index] }, name);
  });
  assert.deepEqual(plain(c.parseLayoutName('гф_10165.JPG')), { prefix: 'гф', sku: '10165' });
  assert.equal(c.parseLayoutName('10165.jpg'), null);
  assert.equal(c.parseLayoutName('ГФ__x.jpg'), null);
  assert.equal(c.parseLayoutName(''), null);
  assert.equal(c.parseLayoutName(null), null);
});

test('matchLayoutFiles: буквы ГФ/СВ не важны, 101650 — не 10165, два файла — оба по пути', () => {
  const files = ['ГФ_10165_3_80x120.jpg', 'ГФ_101650_1.jpg', 'СВ_15054_1.jpg', 'ГФ_15053_1.jpg', 'ГФ_10350_2.jpg', 'ГФ_10350_1.jpg', 'гф_10167.JPG'].map(file);
  assert.deepEqual(plain(c.matchLayoutFiles('10165', files)).map(f => f.name), ['ГФ_10165_3_80x120.jpg']);
  assert.deepEqual(plain(c.matchLayoutFiles('15053', files)).map(f => f.name), ['ГФ_15053_1.jpg']);
  assert.deepEqual(plain(c.matchLayoutFiles('15054', files)).map(f => f.name), ['СВ_15054_1.jpg']);
  assert.deepEqual(plain(c.matchLayoutFiles('10350', files)).map(f => f.name), ['ГФ_10350_1.jpg', 'ГФ_10350_2.jpg']);
  assert.deepEqual(plain(c.matchLayoutFiles('10167', files)).map(f => f.name), ['гф_10167.JPG']);
  assert.deepEqual(plain(c.matchLayoutFiles('10003', files)), []);
});

test('resolveLayout: H побеждает правило; H без файла — notFound без запасного правила', () => {
  const files = ['ГФ_10165_3_80x120.jpg', 'ГФ_10165_old.jpg', 'ГФ_10338_D80.jpg', 'ГФ_10350_1.jpg', 'ГФ_10350_2.jpg'].map(file);
  assert.equal(c.resolveLayout('10165', 'ГФ_10165_old.jpg', files).file.name, 'ГФ_10165_old.jpg');
  assert.equal(c.resolveLayout('10165', ' гф_10165_OLD.jpg ', files).file.name, 'ГФ_10165_old.jpg');
  const lost = plain(c.resolveLayout('10338', 'ГФ_10338_new.jpg', files));
  assert.deepEqual(lost, { file: null, problem: 'notFound', candidates: ['ГФ_10338_new.jpg'] });
  assert.equal(c.resolveLayout('10338', '', files).file.name, 'ГФ_10338_D80.jpg');
  assert.deepEqual(plain(c.resolveLayout('10003', '', files)), { file: null, problem: 'missing', candidates: [] });
  const conflict = plain(c.resolveLayout('10350', '', files));
  assert.equal(conflict.problem, 'conflict');
  assert.deepEqual(conflict.candidates, ['ГФ_10350_1.jpg', 'ГФ_10350_2.jpg']);
  // Без H оба файла 10165 подходят правилу — конфликт.
  assert.equal(c.resolveLayout('10165', undefined, files).problem, 'conflict');
});

test('planLayoutCopies: повтор один раз, общий артикул обеих компаний — один файл, неизвестная компания — missing', () => {
  const files = ['ГФ_10165_3_80x120.jpg', 'ГФ_15053_a.jpg', 'ГФ_10350_1.jpg', 'ГФ_10350_2.jpg'].map(file);
  const lines = [
    { company: 'Глобал Фуд', sku: '10165' }, { company: 'Глобал Фуд', sku: '10165' },
    { company: 'Глобал Фуд', sku: '15053' }, { company: 'Студия Вкуса', sku: '15053' },
    { company: 'Глобал Фуд', sku: '10350' }, { company: 'Глобал Фуд', sku: '10003' },
    { company: 'Рога и копыта', sku: '1' }, { company: 'Глобал Фуд', sku: '' }
  ];
  const plan = plain(c.planLayoutCopies(lines, new Map(), COMPANIES, files));
  assert.equal(plan.total, 6);
  assert.deepEqual(plan.copies, [
    { label: 'ГФ 10165', from: 'disk:/r/ГФ_10165_3_80x120.jpg', name: 'ГФ_10165_3_80x120.jpg' },
    { label: 'ГФ 15053', from: 'disk:/r/ГФ_15053_a.jpg', name: 'ГФ_15053_a.jpg' }
  ]);
  assert.deepEqual(plan.problems.map(p => [p.label, p.kind]), [
    ['ГФ 10350', 'conflict'], ['ГФ 10003', 'missing'], ['Рога и копыта 1', 'missing']
  ]);
});

test('planLayoutCopies: колонка H по ключу companyId/sku; H без файла — notFound', () => {
  const files = ['ГФ_10165_3_80x120.jpg', 'ГФ_10165_old.jpg', 'СВ_15053_b.jpg'].map(file);
  const layouts = new Map([['global_food/10165', 'ГФ_10165_old.jpg'], ['studio_vkusa/15053', 'СВ_15053_x.jpg']]);
  const plan = plain(c.planLayoutCopies([{ company: 'Глобал Фуд', sku: '10165' }, { company: 'Студия Вкуса', sku: '15053' }], layouts, COMPANIES, files));
  assert.deepEqual(plan.copies.map(x => x.name), ['ГФ_10165_old.jpg']);
  assert.deepEqual(plan.problems, [{ label: 'СВ 15053', kind: 'notFound', candidates: ['СВ_15053_x.jpg'] }]);
  assert.equal(c.problemLabel(plan.problems[0]), 'СВ 15053 — нет файла «СВ_15053_x.jpg»');
});

test('planLayoutCopies: один и тот же файл в H двух артикулов копируется один раз', () => {
  const files = ['ГФ_common.jpg'].map(file);
  const layouts = new Map([['global_food/10165', 'ГФ_common.jpg'], ['global_food/10167', 'ГФ_common.jpg']]);
  const plan = plain(c.planLayoutCopies([{ company: 'Глобал Фуд', sku: '10165' }, { company: 'Глобал Фуд', sku: '10167' }], layouts, COMPANIES, files));
  assert.equal(plan.copies.length, 1);
  assert.equal(plan.total, 2);
  assert.deepEqual(plan.problems, []);
});

test('planLayoutFill: только пустые H, ручные значения не трогает, 19743 дважды — один файл', () => {
  const files = ['ГФ_10165_3_80x120.jpg', 'ГФ_19743_1.jpg', 'ГФ_10350_1.jpg', 'ГФ_10350_2.jpg', 'ГФ_10338_D80.jpg', 'СВ_99999_x.jpg', 'readme.txt', 'ГФ_manual.jpg'].map(file);
  const a = (row, sku, layout = '') => ({ sheet: 'g', row, companyId: 'global_food', prefix: 'ГФ', sku, layout });
  const plan = plain(c.planLayoutFill([
    a(3, '10165'), a(4, '19743'), a(5, '19743'), a(6, '10350'), a(7, '10003'),
    a(8, '10338', 'ГФ_manual.jpg'), a(9, '10347', 'ГФ_10347_gone.jpg'), a(10, '10350'), a(11, '')
  ], files));
  assert.deepEqual(plan.fills, [
    { sheet: 'g', row: 3, value: 'ГФ_10165_3_80x120.jpg' },
    { sheet: 'g', row: 4, value: 'ГФ_19743_1.jpg' },
    { sheet: 'g', row: 5, value: 'ГФ_19743_1.jpg' }
  ]);
  assert.deepEqual(plan.missing, ['ГФ 10003']);
  assert.deepEqual(plan.conflicts, [{ label: 'ГФ 10350', files: ['ГФ_10350_1.jpg', 'ГФ_10350_2.jpg'] }]);
  assert.deepEqual(plan.notFound, [{ label: 'ГФ 10347', value: 'ГФ_10347_gone.jpg' }]);
  assert.deepEqual(plan.unusedFiles.sort(), ['readme.txt', 'СВ_99999_x.jpg'].sort());
});

test('orderFolderName, layoutStatusCode, diskErrorKind', () => {
  assert.equal(c.orderFolderName('FB-0042 от 09.11.2026', '18.10.05'), 'FB-0042 от 09.11.2026 18.10.05');
  assert.equal(c.orderFolderName('a/b:c*?"<>|\\', ''), 'a-b-c-------');
  Object.entries(LAYOUT_STATUS).forEach(([key, word]) => assert.equal(c.layoutStatusCode(word), key));
  assert.equal(c.layoutStatusCode(' Готово '), 'done');
  assert.equal(c.layoutStatusCode(''), '');
  assert.equal(c.layoutStatusCode(undefined), '');
  assert.equal(c.layoutStatusCode('что-то'), '');
  assert.deepEqual([401, 403, 404, 409, 423, 429, 500, 503, 507, 200, 201, 202].map(c.diskErrorKind),
    ['auth', 'auth', 'notFound', 'fatal', 'retry', 'retry', 'retry', 'retry', 'retry', '', '', '']);
  const error = c.DiskError('retry', 'x');
  assert.equal(error.kind, 'retry');
  assert.equal(error.message, 'x');
});

test('pluralRu, limitedList, problemLabel', () => {
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25, 111, 0].map(n => c.pluralRu(n, 'файл', 'файла', 'файлов')),
    ['файл', 'файла', 'файлов', 'файлов', 'файлов', 'файл', 'файла', 'файлов', 'файлов', 'файлов']);
  assert.equal(c.limitedList(['a', 'b'], 100), 'a, b');
  assert.equal(c.limitedList(['ГФ 10001', 'ГФ 10002', 'ГФ 10003', 'ГФ 10004'], 30), 'ГФ 10001, ГФ 10002 и ещё 2');
  assert.ok(c.limitedList(Array.from({ length: 50 }, (_, i) => `x${i}`), 5).length <= 5);
  assert.equal(c.problemLabel({ label: 'ГФ 10003', kind: 'missing' }), 'ГФ 10003');
  assert.equal(c.problemLabel({ label: 'ГФ 10350', kind: 'conflict', candidates: ['a', 'b'] }), 'ГФ 10350 — несколько файлов');
  assert.equal(c.problemLabel({ label: 'ГФ 10338', kind: 'failed', reason: 'файл пропал с Диска' }), 'ГФ 10338 — файл пропал с Диска');
});

test('layoutsMessage: готово, не все, пусто, ошибка, длинный список не длиннее 4000', () => {
  const done = c.layoutsMessage('FB-0042 от 09.11.2026', { status: 'done', copied: 3, url: 'https://disk.yandex.ru/d/X' }, 'root');
  assert.match(done, /FB-0042 от 09\.11\.2026: 3 файла/);
  assert.match(done, /https:\/\/disk\.yandex\.ru\/d\/X/);
  const problems = [
    { label: 'ГФ 10003', kind: 'missing', candidates: [] },
    { label: 'ГФ 10350', kind: 'conflict', candidates: ['ГФ_10350_1.jpg', 'ГФ_10350_2.jpg'] }
  ];
  const partial = c.layoutsMessage('FB-0042', { status: 'partial', copied: 2, total: 4, url: 'https://u', problems }, 'root');
  assert.match(partial, /2 из 4 арт\./);
  assert.match(partial, /Нет макета: ГФ 10003/);
  assert.match(partial, /Несколько макетов: ГФ 10350 \(ГФ_10350_1\.jpg, ГФ_10350_2\.jpg\)/);
  const empty = c.layoutsMessage('FB-0042', { status: 'empty', problems }, 'disk:/root');
  assert.match(empty, /ни одного файла не найдено в «disk:\/root»/);
  const failed = c.layoutsMessage('FB-0042', { status: 'failed', reason: 'нет позиций.' }, '');
  assert.match(failed, /не собраны: нет позиций\./);
  assert.match(failed, /Собрать папку/);
  const many = Array.from({ length: 300 }, (_, i) => ({ label: `ГФ ${10000 + i}`, kind: i % 2 ? 'missing' : 'conflict', candidates: ['ГФ_1_a.jpg', 'ГФ_1_b.jpg'] }));
  const big = c.layoutsMessage('FB-0042', { status: 'partial', copied: 1, total: 301, url: 'https://u', problems: many }, 'root');
  assert.ok(big.length <= 4000, `length ${big.length}`);
  assert.match(big, /и ещё \d+/);
  assert.match(big, /https:\/\/u/);
});

test('tokenMessage говорит о YANDEX_DISK_TOKEN', () => {
  assert.match(c.tokenMessage(), /YANDEX_DISK_TOKEN/);
});

test('isDiskUploadUrl: адрес Яндекса с портом :443 и без него — да, чужой и другой порт — нет', () => {
  assert.equal(c.isDiskUploadUrl('https://uploader1d.dst.yandex.net:443/upload-target/20261125T1/abc'), true);
  assert.equal(c.isDiskUploadUrl('https://uploader1.disk.yandex.net/upload/x'), true);
  assert.equal(c.isDiskUploadUrl('https://uploader.yandex.ru:443/upload/x'), true);
  assert.equal(c.isDiskUploadUrl('https://uploader.yandex.net:8080/upload/x'), false);
  assert.equal(c.isDiskUploadUrl('https://yandex.net.evil.com/upload/x'), false);
  assert.equal(c.isDiskUploadUrl('https://evil.com/?yandex.net/'), false);
  assert.equal(c.isDiskUploadUrl('http://uploader.yandex.net/upload/x'), false);
  assert.equal(c.isDiskUploadUrl(''), false);
});
