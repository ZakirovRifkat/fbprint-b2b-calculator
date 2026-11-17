// Версии файлов сайта в index.html: браузер берёт новый файл, как только он изменился.
//
// Каждый файл получает метку из хэша своего содержимого: style.css?v=3f2a9c1b0d.
// Стили, config.js и js/main.js — прямо в ссылках. Модули, которые main.js подтягивает через import,
// — в карте импортов (importmap): ./js/order.js → ./js/order.js?v=…. Меняется файл — меняется адрес,
// и старая копия из кэша браузера уже не подходит. Неизменённые файлы остаются в кэше.
// meta app-version — общая версия сайта: по ней открытая вкладка узнаёт, что сайт обновился (js/version.js).
//
// Запуск перед каждым коммитом, который меняет стили или скрипты:
//   node tools/stamp-version.mjs          — обновить index.html
//   node tools/stamp-version.mjs --check  — только проверить (то же делает тест tests/version.test.js)
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- Версии файлов: node tools/stamp-version.mjs. Не правьте руками. -->';
const END = '<!-- /версии файлов -->';

const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 10);

// Файлы, которые грузит страница: стили, настройки и все модули из js/.
export function siteFiles(root = ROOT) {
  const modules = fs.readdirSync(path.join(root, 'js')).filter(name => name.endsWith('.js')).sort().map(name => `js/${name}`);
  return ['tokens.css', 'style.css', 'config.js', ...modules];
}

export function fileVersions(root = ROOT) {
  // Переводы строк приводятся к LF: Git на Windows выгружает файлы с CRLF, а GitHub отдаёт с LF.
  // Без этого метки менялись бы от одной выгрузки, хотя содержимое то же.
  const text = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  return Object.fromEntries(siteFiles(root).map(file => [file, hash(text(file))]));
}

export function siteVersion(versions) {
  return hash(Object.entries(versions).map(([file, version]) => `${file}:${version}`).join('\n'));
}

// index.html с проставленными версиями. Повторный запуск без изменений файлов ничего не меняет.
export function stampedIndex(html, versions) {
  const url = file => `${file}?v=${versions[file]}`;
  const modules = Object.keys(versions).filter(file => file.startsWith('js/') && file !== 'js/main.js');
  const imports = Object.fromEntries(modules.map(file => [`./${file}`, `./${url(file)}`]));
  const block = [
    START,
    `  <meta name="app-version" content="${siteVersion(versions)}">`,
    `  <link rel="stylesheet" href="${url('tokens.css')}">`,
    `  <link rel="stylesheet" href="${url('style.css')}">`,
    '  <script type="importmap">',
    JSON.stringify({ imports }, null, 2).split('\n').map(line => `  ${line}`).join('\n'),
    '  </script>',
    `  ${END}`
  ].join('\n');

  let result = html;
  if (result.includes(START)) {
    const from = result.indexOf(START);
    const to = result.indexOf(END, from) + END.length;
    result = result.slice(0, from) + block + result.slice(to);
  } else {
    // Первый запуск: блок встаёт на место двух ссылок на стили.
    const styles = /<link rel="stylesheet" href="tokens\.css">\s*<link rel="stylesheet" href="style\.css">/;
    if (!styles.test(result)) throw new Error('В index.html не найдены ссылки на tokens.css и style.css');
    result = result.replace(styles, block);
  }
  return result
    .replace(/<script src="config\.js(\?v=[^"]*)?"><\/script>/, `<script src="${url('config.js')}"></script>`)
    .replace(/<script type="module" src="js\/main\.js(\?v=[^"]*)?"><\/script>/, `<script type="module" src="${url('js/main.js')}"></script>`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const indexPath = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const next = stampedIndex(html, fileVersions());
  if (process.argv.includes('--check')) {
    if (next !== html) {
      console.error('Версии в index.html устарели: запустите node tools/stamp-version.mjs');
      process.exit(1);
    }
    console.log('Версии в index.html актуальны');
  } else {
    if (next !== html) fs.writeFileSync(indexPath, next);
    console.log(next === html ? 'Версии не изменились' : `index.html обновлён, версия сайта ${siteVersion(fileVersions())}`);
  }
}
