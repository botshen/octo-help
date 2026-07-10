import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RELEASE_TYPES = new Set(['patch', 'minor', 'major']);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })?.trim();
}

function fail(message) {
  console.error(`\n发布终止：${message}`);
  process.exit(1);
}

function nextVersion(current, target) {
  if (SEMVER_PATTERN.test(target)) return target;
  if (!RELEASE_TYPES.has(target)) {
    fail('版本参数必须是 patch、minor、major 或完整版本号（例如 1.2.3）。');
  }

  const [major, minor, patch] = current.split('.').map(Number);
  if (target === 'major') return `${major + 1}.0.0`;
  if (target === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('用法：pnpm release [patch|minor|major|x.y.z]');
  process.exit(0);
}

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const currentVersion = packageJson.version;
if (!SEMVER_PATTERN.test(currentVersion)) fail(`package.json 中的版本号无效：${currentVersion}`);

const target = process.argv[2] ?? 'patch';
const version = nextVersion(currentVersion, target);
if (version === currentVersion) fail(`目标版本不能与当前版本相同：${version}`);

const branch = run('git', ['branch', '--show-current'], { capture: true });
if (branch !== 'main') fail(`只能从 main 分支发布，当前分支是 ${branch || 'detached HEAD'}。`);

const status = run('git', ['status', '--porcelain'], { capture: true });
if (status) fail('工作区存在未提交修改，请先提交或处理这些修改。');

console.log(`准备发布 v${version}（当前 v${currentVersion}）`);
run('git', ['fetch', 'origin', 'main', '--tags']);

const [behind] = run(
  'git',
  ['rev-list', '--left-right', '--count', 'origin/main...HEAD'],
  { capture: true },
).split(/\s+/).map(Number);
if (behind > 0) fail(`本地 main 落后 origin/main ${behind} 个提交，请先同步。`);

try {
  run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/v${version}`], { capture: true });
  fail(`tag v${version} 已存在。`);
} catch (error) {
  if (error?.status !== 1) throw error;
}

run('pnpm', ['compile']);
run('pnpm', ['version', version, '--no-git-tag-version']);

try {
  run('pnpm', ['zip']);
} catch (error) {
  run('git', ['restore', '--', 'package.json', 'pnpm-lock.yaml']);
  throw error;
}

run('git', ['add', 'package.json', 'pnpm-lock.yaml']);
run('git', ['commit', '-m', `chore(release): v${version}`]);
run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`]);

try {
  run('git', ['push', '--atomic', 'origin', 'HEAD:main', `v${version}`]);
} catch (error) {
  console.error(`\n本地提交和 tag v${version} 已创建，但推送失败。修复连接或权限后执行：`);
  console.error(`git push --atomic origin HEAD:main v${version}`);
  throw error;
}

console.log(`\nv${version} 已推送，GitHub Actions 正在创建 Release。`);
