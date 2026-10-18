#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

process.chdir(dirname(dirname(fileURLToPath(import.meta.url))));

const LF = String.fromCharCode(10);
const PKG = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const VERSION = PKG.version;
const PKG_NAME = PKG.name;
const GH_USER = 'chinartcn';
const REPO = GH_USER + '/tred';
const FULL_PKG = PKG_NAME + '@' + VERSION;

const args = process.argv.slice(2);
const has = (f) => args.includes(f);

function log(m) { console.log(m); }
function sep(t) {
  log('');
  log('═══════════════════════════════════════════════════════════');
  log('  ' + t);
  log('═══════════════════════════════════════════════════════════');
}
function run(cmd, a) {
  log('');
  log('$ ' + cmd + ' ' + a.join(' '));
  log('');
  const r = spawnSync(cmd, a, { stdio: 'inherit' });
  return r.status ?? 1;
}

// ═════════════════════════════════════════════════════════════════
// --help / 无参数：显示用法
// ═════════════════════════════════════════════════════════════════
if (args.length === 0 || has('--help') || has('-h')) {
  sep('tred v' + VERSION + ' 发布脚本');
  log('  包: ' + FULL_PKG);
  log('  仓库: github.com/' + REPO);
  log('');
  log('  用法:');
  log('    node publish-v1.2.0.mjs --git        只做 git init + add + commit');
  log('    node publish-v1.2.0.mjs --repo       只做 gh repo create + push');
  log('    node publish-v1.2.0.mjs --tag        只做 git tag + push --tags');
  log('    node publish-v1.2.0.mjs --strip      剥离锚点并打包（准备发布）');
  log('    node publish-v1.2.0.mjs --publish    只做 npm publish（不可逆）');
  log('    node publish-v1.2.0.mjs --release    只做 gh release create');
  log('    node publish-v1.2.0.mjs --verify     只做验证');
  log('');
  log('  全流程:');
  log('    node publish-v1.2.0.mjs --git --repo --tag --publish --release');
  log('    node publish-v1.2.0.mjs --all');
  log('');
  log('  推荐：一步步跑，每步完成后手动检查再下一步');
  log('');
  process.exit(0);
}

// ═════════════════════════════════════════════════════════════════
// PRECHECK（所有模式下都跑）
// ═════════════════════════════════════════════════════════════════
function precheck() {
  const tredVer = fs.readFileSync('.tred-version', 'utf-8').trim();
  if (tredVer !== VERSION) {
    console.error('[error] 版本不一致: package=' + VERSION + ', .tred-version=' + tredVer);
    process.exit(1);
  }
  if (!fs.existsSync('dist/cli.js')) { console.error('[error] dist/cli.js 不存在'); process.exit(1); }
  if (!fs.existsSync('bin/tred.mjs')) { console.error('[error] bin/tred.mjs 不存在'); process.exit(1); }

  const who = spawnSync('npm', ['whoami'], { encoding: 'utf-8' });
  if (who.status !== 0) { console.error('[error] npm 未登录'); process.exit(1); }

  const gh = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8' });
  if (gh.status !== 0) { console.error('[error] gh 未登录'); process.exit(1); }

  // 清理 tgz
  for (const f of fs.readdirSync('.').filter((x) => x.endsWith('.tgz'))) {
    fs.unlinkSync(f);
    log('[cleanup] ' + f);
  }
}

// ═════════════════════════════════════════════════════════════════
// --git : git init + add + commit
// ═════════════════════════════════════════════════════════════════
function doGit() {
  sep('--git : git init + add + commit');
  precheck();

  // 追加 /*.mjs 到 gitignore（幂等）
  {
    const gi = fs.readFileSync('.gitignore', 'utf-8');
    if (gi.indexOf('/*.mjs') < 0) {
      fs.writeFileSync('.gitignore', gi.trimEnd() + LF + LF + '# 根目录一次性工具脚本' + LF + '/*.mjs' + LF + '!bin/tred.mjs' + LF);
      log('[fix] .gitignore + /*.mjs');
    } else {
      log('[skip] .gitignore 已含 /*.mjs');
    }
  }

  const hasGit = fs.existsSync('.git');
  if (hasGit) {
    log('[skip] .git 已存在');
  } else {
    if (run('git', ['init', '-b', 'main']) !== 0) process.exit(1);
    log('[ok] git init');
  }

  if (run('git', ['add', '.']) !== 0) process.exit(1);

  const st = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf-8' });
  if (!st.stdout.trim()) {
    log('[skip] 无变更可提交');
  } else {
    if (run('git', ['commit', '-m', 'v' + VERSION + ': initial release']) !== 0) process.exit(1);
    log('[ok] commit 完成');
  }

  // 显示首次 commit 内容概要
  const ls = spawnSync('git', ['ls-files'], { encoding: 'utf-8' });
  const files = (ls.stdout || '').split(LF).filter(Boolean);
  log('');
  log('[info] 已跟踪 ' + files.length + ' 个文件');
  log('  前 10 个:');
  for (const f of files.slice(0, 10)) log('    ' + f);
  if (files.length > 10) log('    ... (共 ' + files.length + ')');
  log('');
  log('  确认没误加 node_modules / dist / .archive:');
  const bad = files.filter((f) => f.indexOf('node_modules/') === 0 || f.indexOf('dist/') === 0 || f.indexOf('.archive/') === 0);
  if (bad.length === 0) {
    log('  ✓ 无意外文件');
  } else {
    log('  ❌ 意外跟踪:');
    for (const f of bad.slice(0, 20)) log('    ' + f);
  }
}

// ═════════════════════════════════════════════════════════════════
// --repo : gh repo create
// ═════════════════════════════════════════════════════════════════
function doRepo() {
  sep('--repo : GitHub 创建远程仓库并 push');
  precheck();

  if (!fs.existsSync('.git')) {
    console.error('[error] .git 不存在，先跑 --git');
    process.exit(1);
  }

  // 检查 remote
  const rem = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' });
  if (rem.status === 0) {
    log('[skip] origin 已存在: ' + rem.stdout.trim());
    log('[info] 直接 push');
    if (run('git', ['push', '-u', 'origin', 'main']) !== 0) process.exit(1);
    log('[ok] push 完成');
    return;
  }

  // 检查远程仓库是否存在
  const view = spawnSync('gh', ['repo', 'view', REPO], { encoding: 'utf-8' });
  if (view.status === 0) {
    log('[info] 远程仓库 ' + REPO + ' 已存在');
    log('[info] 添加 remote 并 push');
    if (run('git', ['remote', 'add', 'origin', 'https://github.com/' + REPO + '.git']) !== 0) process.exit(1);
    if (run('git', ['push', '-u', 'origin', 'main']) !== 0) process.exit(1);
    log('[ok] push 完成');
    return;
  }

  // 新建
  if (run('gh', ['repo', 'create', REPO, '--public', '--source=.', '--push']) !== 0) {
    console.error('');
    console.error('[warn] gh repo create 失败，手动补救:');
    console.error('  git remote add origin https://github.com/' + REPO + '.git');
    console.error('  git push -u origin main');
    process.exit(1);
  }
  log('[ok] 仓库已创建并 push');
}

// ═════════════════════════════════════════════════════════════════
// --tag : git tag
// ═════════════════════════════════════════════════════════════════
function doTag() {
  sep('--tag : git tag + push');
  precheck();

  const tagName = 'v' + VERSION;

  const tags = spawnSync('git', ['tag', '-l', tagName], { encoding: 'utf-8' });
  if (tags.stdout.trim() === tagName) {
    log('[skip] tag ' + tagName + ' 已存在');
  } else {
    if (run('git', ['tag', tagName]) !== 0) process.exit(1);
    log('[ok] tag ' + tagName + ' 创建');
  }

  if (run('git', ['push', 'origin', 'main', '--tags']) !== 0) process.exit(1);
  log('[ok] tag 已推送到远程');
}

// ═════════════════════════════════════════════════════════════════
// --publish : npm publish（不可逆）
// ═════════════════════════════════════════════════════════════════
function doStrip() {
  sep('--strip : 准备发布包（剥离锚点并打包）');
  precheck();

  log('[tred] 自动剥离 src/ 和 examples/ 中的内部锚点...');
  if (run('node', ['bin/tred.mjs', 'strip', '--dir', 'src', '--apply']) !== 0) process.exit(1);
  if (run('node', ['bin/tred.mjs', 'strip', '--dir', 'examples', '--apply']) !== 0) process.exit(1);
  
  log('[tred] 重新构建纯净版 dist/');
  if (run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']) !== 0) process.exit(1);

  log('[tred] 生成 npm 打包文件...');
  if (run('npm', ['pack']) !== 0) process.exit(1);

  log('');
  log('✅ 准备完成！请在当前目录检查生成的 .tgz 文件。');
  log('   如果确认无误，运行 `node scripts/release.mjs --publish` 正式发布。');
  log('   (发布完成后会自动恢复本地源码的锚点状态)');
}

function doPublish() {
  sep('--publish : ⚠️ npm publish（不可逆）');
  precheck();

  sep('--publish : ⚠️ npm publish（不可逆）');
  precheck();

  log('  ┌─────────────────────────────────────────────────────┐');
  log('  │  ⚠️  你显式跑了 --publish，代表确认发布             │');
  log('  │                                                     │');
  log('  │  发布后 ' + FULL_PKG.padEnd(12) + ' 归 rtcn         │');
  log('  │  24h 内可 npm unpublish --force 撤回                │');
  log('  │  之后永久不可撤回                                    │');
  log('  │                                                     │');
  log('  │  如果开了 2FA，会提示输入 OTP                       │');
  log('  └─────────────────────────────────────────────────────┘');
  log('');

  // 检查是否已发布
  const view = spawnSync('npm', ['view', FULL_PKG, 'version'], { encoding: 'utf-8' });
  if (view.status === 0 && view.stdout.trim() === VERSION) {
    log('[skip] ' + FULL_PKG + ' 已在 npm 上');
    process.exit(0);
  }

  // v2.2.0 安全升级：直接发布之前用 --strip 打好的包，所见即所发！
  const tgzFiles = fs.readdirSync('.').filter(f => f.startsWith('rtcn-tred-') && f.endsWith('.tgz'));
  if (tgzFiles.length === 0) {
    console.error('[error] 找不到打包文件。请先运行 node scripts/release.mjs --strip');
    process.exit(1);
  }
  const targetTgz = tgzFiles.sort().reverse()[0]; // 取最新版本
  log('[tred] 准备发布本地包: ' + targetTgz);

  if (run('npm', ['publish', targetTgz, '--access', 'public']) !== 0) {
    log('[tred] 发布失败，恢复 git 状态...');
    run('git', ['reset', '--hard', 'HEAD']);
    console.error('');
    console.error('[error] npm publish 失败。');
    process.exit(1);
  }
  log('[ok] 已发布');
  log('[tred] 恢复本地源码的锚点状态...');
  run('git', ['reset', '--hard', 'HEAD']);
  log('');
  log('  npm: https://www.npmjs.com/package/' + PKG_NAME);
}

// ═════════════════════════════════════════════════════════════════
// --release : gh release
// ═════════════════════════════════════════════════════════════════
function doRelease() {
  sep('--release : GitHub Release');
  precheck();

  const tagName = 'v' + VERSION;

  const view = spawnSync('gh', ['release', 'view', tagName], { encoding: 'utf-8' });
  if (view.status === 0) {
    log('[skip] release ' + tagName + ' 已存在');
    return;
  }

  const changelog = fs.readFileSync('CHANGELOG.md', 'utf-8');
  const notes = changelog.split(LF).slice(0, 30).join(LF);
  const tmp = '.tred-tmp/release-notes.md';
  fs.mkdirSync('.tred-tmp', { recursive: true });
  fs.writeFileSync(tmp, notes);

  if (run('gh', ['release', 'create', tagName, '--title', tagName, '--notes-file', tmp]) !== 0) {
    console.error('[warn] release 失败，手动补救:');
    console.error('  gh release create ' + tagName + ' --title "' + tagName + '" --notes-file ' + tmp);
    fs.rmSync(tmp, { force: true });
    process.exit(1);
  }
  fs.rmSync(tmp, { force: true });
  log('[ok] release 已创建');
}

// ═════════════════════════════════════════════════════════════════
// --verify : 只读验证
// ═════════════════════════════════════════════════════════════════
function doVerify() {
  sep('--verify : 验证发布状态');

  log('  $ npm view ' + PKG_NAME + ' version');
  const v1 = spawnSync('npm', ['view', PKG_NAME, 'version'], { encoding: 'utf-8' });
  log('  → ' + (v1.stdout || '').trim() || '(不存在)');

  log('');
  log('  $ gh repo view ' + REPO);
  const v2 = spawnSync('gh', ['repo', 'view', REPO], { encoding: 'utf-8' });
  if (v2.status === 0) log('  ✓ 仓库可访问: https://github.com/' + REPO);
  else log('  ⚠ 仓库不可访问');

  log('');
  log('  $ gh release view v' + VERSION);
  const v3 = spawnSync('gh', ['release', 'view', 'v' + VERSION], { encoding: 'utf-8' });
  if (v3.status === 0) log('  ✓ release 存在');
  else log('  · release 尚未创建');

  log('');
  log('  $ git remote -v');
  const v4 = spawnSync('git', ['remote', '-v'], { encoding: 'utf-8' });
  log('  ' + (v4.stdout || '').trim().split(LF).join(LF + '  '));

  log('');
  log('  $ git tag -l');
  const v5 = spawnSync('git', ['tag', '-l'], { encoding: 'utf-8' });
  log('  ' + (v5.stdout || '').trim().split(LF).join(' '));
}

// ═════════════════════════════════════════════════════════════════
// 主流程
// ═════════════════════════════════════════════════════════════════
if (has('--all')) {
  doGit();
  doRepo();
  doTag();
  doStrip();
  doPublish();
  doRelease();
  doVerify();
} else {
  if (has('--strip')) doStrip();
  if (has('--git')) doGit();
  if (has('--repo')) doRepo();
  if (has('--tag')) doTag();
  if (has('--publish')) doPublish();
  if (has('--release')) doRelease();
  if (has('--verify')) doVerify();
}

sep('完成');
log('  包名:    ' + FULL_PKG);
log('  npm:     https://www.npmjs.com/package/' + PKG_NAME);
log('  repo:    https://github.com/' + REPO);
log('  release: https://github.com/' + REPO + '/releases/tag/v' + VERSION);
log('');
log('  用户可以:');
log('    npm i -D ' + PKG_NAME);
log('    npx ' + PKG_NAME + ' --help');
log('    npx ' + PKG_NAME + ' doctor');
log('');
