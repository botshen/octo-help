import { readFileSync } from 'node:fs';

const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const input = process.argv[2];

if (!input || !VERSION_PATTERN.test(input)) {
  console.error('用法：pnpm release:notes v1.2.3');
  process.exit(1);
}

const version = input.replace(/^v/, '');
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const escapedVersion = version.replace(/\./g, '\\.');
const heading = new RegExp(`^## \\[${escapedVersion}\\](?: - \\d{4}-\\d{2}-\\d{2})?\\s*$`, 'm');
const match = heading.exec(changelog);

if (!match) {
  console.error(`CHANGELOG.md 中缺少版本 ${version} 的二级标题。`);
  process.exit(1);
}

const afterHeading = changelog.slice(match.index + match[0].length).replace(/^\s+/, '');
const nextHeadingIndex = afterHeading.search(/^## /m);
const referencesIndex = afterHeading.search(/^\[[^\]]+\]:\s+/m);
const sectionEnd = [nextHeadingIndex, referencesIndex]
  .filter((index) => index >= 0)
  .reduce((earliest, index) => Math.min(earliest, index), afterHeading.length);
const notes = afterHeading.slice(0, sectionEnd).trim();

if (!notes) {
  console.error(`CHANGELOG.md 中版本 ${version} 没有更新内容。`);
  process.exit(1);
}

process.stdout.write(`${notes}\n\n### 安装\n\n`);
process.stdout.write('下载本 Release 中的 Chrome ZIP，解压后在 `chrome://extensions` 打开「开发者模式」，选择「加载已解压的扩展程序」。\n\n');
process.stdout.write('> 仅适用于 `im.deepminer.com.cn`；所有处理均在浏览器本地完成。\n');
