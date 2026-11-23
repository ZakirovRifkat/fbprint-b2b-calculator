// Проверка папки requirements и сборка списка открытых вопросов.
// Запуск из корня репозитория: node requirements/_tools/check.mjs
// 1. Ищет битые ссылки, вики-ссылки, повторы номеров требований и префиксов, номера с чужим префиксом.
// 2. Пересобирает open-issues.md из пометок [!question] и [!warning].
// Код выхода 1, если нашлись ошибки из пункта 1.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!name.startsWith('.') && !name.startsWith('_')) walk(full);
    } else if (name.endsWith('.md')) files.push(full);
  }
})(root);

const problems = [];
const ids = new Map();
const prefixFiles = new Map();
let total = 0;

for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  const template = rel.startsWith('templates/');
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const prefix = front?.[1].match(/^prefix:\s*(\S+)/m)?.[1];
  if (prefix && !template) prefixFiles.set(prefix, [...(prefixFiles.get(prefix) ?? []), rel]);

  const body = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) problems.push(`${rel}: вики-ссылка [[${m[1]}]]`);
  for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^[a-z]+:/i.test(href) || href.startsWith('#')) continue;
    const target = decodeURIComponent(href.split('#')[0]);
    if (target && !existsSync(normalize(join(dirname(file), target)))) problems.push(`${rel}: битая ссылка ${href}`);
  }
  if (template) continue;
  for (const m of body.matchAll(/^\s*[-*]\s+(?:~~)?\*\*([A-Z]+-\d+)\.?\*\*/gm)) {
    total++;
    const id = m[1];
    ids.set(id, [...(ids.get(id) ?? []), rel]);
    if (prefix && !id.startsWith(`${prefix}-`)) problems.push(`${rel}: номер ${id} не с префиксом файла ${prefix}`);
  }
}
for (const [id, where] of ids) if (where.length > 1) problems.push(`номер ${id} повторяется: ${where.join(', ')}`);
for (const [prefix, where] of prefixFiles) if (where.length > 1) problems.push(`префикс ${prefix} у нескольких файлов: ${where.join(', ')}`);

// Список открытых вопросов
const groups = [['pages', 'Страницы'], ['components', 'Компоненты'], ['rules', 'Правила']];
const kinds = { question: [], warning: [] };
for (const [dir] of groups) {
  for (const name of readdirSync(join(root, dir)).filter(n => n.endsWith('.md')).sort()) {
    const rel = `${dir}/${name}`;
    const text = readFileSync(join(root, rel), 'utf8');
    const title = text.match(/^# (.+)$/m)?.[1] ?? name;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^>\s*\[!(question|warning)\]/);
      if (!m) continue;
      const body = [];
      for (let j = i + 1; j < lines.length && lines[j].startsWith('>'); j++) body.push(lines[j].replace(/^>\s?/, ''));
      const summary = body.join(' ').replace(/\s+/g, ' ').trim()
        .replace(/\]\((?!https?:|#)([^)]+)\)/g, (all, href) => {
          const out = [];
          for (const part of `${dir}/${href}`.split('/')) { if (part === '..') out.pop(); else if (part !== '.') out.push(part); }
          return `](${out.join('/')})`;
        });
      kinds[m[1]].push({ dir, rel, title, summary });
    }
  }
}
const section = (items, heading) => {
  let out = `## ${heading} (${items.length})\n\n`;
  for (const [dir, label] of groups) {
    const list = items.filter(item => item.dir === dir);
    if (!list.length) continue;
    out += `### ${label}\n`;
    let current = '';
    for (const item of list) {
      if (item.rel !== current) {
        current = item.rel;
        out += `\n**[${item.title}](${item.rel})**\n\n`;
      }
      out += `- ${item.summary}\n`;
    }
    out += '\n';
  }
  return out;
};
const today = new Date().toLocaleDateString('ru-RU');
writeFileSync(join(root, 'open-issues.md'), `---
tags: [index]
aliases: [Открытые вопросы, Расхождения, Вопросы]
---

# Открытые вопросы и расхождения

[← Оглавление](README.md)

Собрано из всех файлов автоматически ${today} командой \`node requirements/_tools/check.mjs\`. Источник правды — сами файлы: если пометку там исправили или убрали, запустите команду снова. В Obsidian те же пометки находит поиск \`[!question]\` и \`[!warning]\`.

- **Вопрос** — неясно, как должно быть. Нужен ответ: так и оставить или изменить.
- **Расхождение** — код ведёт себя не так, как написано в \`README.md\` или \`API_CONTRACT.md\`, или похоже на ошибку. Найдено при чтении кода, в браузере не проверялось.

${section(kinds.question, 'Вопросы')}${section(kinds.warning, 'Расхождения')}`);

console.log(`Файлов: ${files.length}. Требований: ${total}. Вопросов: ${kinds.question.length}. Расхождений: ${kinds.warning.length}.`);
console.log('open-issues.md пересобран.');
if (problems.length) {
  console.log(`\nОшибки (${problems.length}):`);
  problems.forEach(p => console.log(`  ${p}`));
  process.exitCode = 1;
} else {
  console.log('Ошибок нет: ссылки целы, номера и префиксы не повторяются.');
}
