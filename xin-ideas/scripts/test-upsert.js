#!/usr/bin/env node
/* ============================================================================
 * xin-ideas 合并器回归测试
 * ----------------------------------------------------------------------------
 * 核心断言只有一条：**任何情况下，已有灵感一条都不能丢。**
 * 覆盖场景：
 *   1. 全新目录        → 新建索引 + 明细页
 *   2. 再次追加        → 原有条目全部保留
 *   3. 索引结构不一致  → 备份 index.html.bak，重建后旧灵感全在
 *   4. 再次结构不一致  → 不覆盖已存在的 .bak（改用带时间戳的新备份）
 *   5. 明细页已存在    → 拒绝覆盖（退出码非 0）
 *   6. 明细页已存在 + --force → 先备份 .bak 再覆盖
 *   7. 孤儿明细页      → 写入时自动补回索引
 *   8. --dry-run       → 不落盘
 *   9. 生成索引可渲染  → 结构完整、无 undefined
 *  10. --sync-pages    → 列表页模板升级后同步存量明细页，IDEA 数据逐字不丢
 *  11. --sync-index    → 列表页模板升级后同步索引页，IDEAS 数据一条不丢
 *
 * 运行：node scripts/test-upsert.js
 * 退出码 0 = 全绿；1 = 有断言失败。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'upsert-idea.js');
const NODE = process.execPath;

let passed = 0, failed = 0;
function ok(cond, label, extra) {
  if (cond) { passed++; console.log('  ok    ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (extra ? '  —— ' + extra : '')); }
}

/* 造一个 idea.json */
function idea(n, title) {
  return {
    title: title,
    ts: `2026-09-14 1${n}:00`,
    tags: ['测试'],
    origin: `这是第 ${n} 条灵感的构思原话（原话要一字不差保留）`,
    scores: { 解决问题: 7, 实用性: 7, 市场价值: 7, 竞品分析: 7, 变现可能: 7, 技术方案: 7, 可扩展性: 7, 实现计划: 7 },
    details: { 解决问题: '段一\n\n段二', 实用性: 'x', 市场价值: 'x', 竞品分析: 'x', 变现可能: 'x', 技术方案: 'x', 可扩展性: 'x', 实现计划: 'x' },
    pros: ['好处'], cons: ['代价'],
    risks: [{ q: '问题', a: '应对' }],
    roadmap: [{ phase: '第 0 步', goal: '目标', steps: ['动作'], done: '完成标志' }],
    avoid: ['坑'],
    metrics: [{ name: '指标', target: '成功线', fail: '止损线' }],
    cost: { effort: { v: '1 人日', n: '说明' }, time: { v: '1 周', n: '说明' }, money: { v: '≈¥0', n: '说明' }, other: '机会成本' }
  };
}

function run(base, ...extra) {
  const r = spawnSync(NODE, [SCRIPT, '--base', base, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function readIndexIds(base) {
  const p = path.join(base, '.xin-ideas', 'index.html');
  if (!fs.existsSync(p)) return null;
  const html = fs.readFileSync(p, 'utf8');
  const m = html.match(/const\s+IDEAS\s*=\s*(\[[\s\S]*?\n\];)/);
  if (!m) return null;
  try { return eval('(' + m[1].replace(/;\s*$/, '') + ')'); } catch (e) { return null; }
}

function writeJson(dir, name, obj) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  return p;
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'xin-ideas-test-'));
const TMPJSON = path.join(ROOT, '_json');
fs.mkdirSync(TMPJSON, { recursive: true });

try {
  /* ---------------------------------------------------- 1. 全新目录：新建 */
  const A = path.join(ROOT, 'caseA');
  fs.mkdirSync(A, { recursive: true });
  let r = run(A, '--detail', writeJson(TMPJSON, 'a1.json', idea(1, '灵感甲')), '--ts', '20260914_100000');
  let ids = readIndexIds(A);
  ok(r.code === 0 && Array.isArray(ids) && ids.length === 1, '1) 全新目录 → 新建索引含 1 条', r.out.trim());
  ok(fs.existsSync(path.join(A, '.xin-ideas', 'ideas', 'idea_20260914_100000.html')), '1) 明细页已生成');
  ok(ids && ids[0].origin === '这是第 1 条灵感的构思原话（原话要一字不差保留）', '1) 原话一字不差写入索引');

  /* --------------------------------------------- 2. 再次追加：原有不丢 */
  r = run(A, '--detail', writeJson(TMPJSON, 'a2.json', idea(2, '灵感乙')), '--ts', '20260914_110000');
  ids = readIndexIds(A);
  ok(r.code === 0 && ids && ids.length === 2, '2) 再次追加 → 索引 2 条', r.out.trim());
  ok(ids && ids.some(x => x.id === '20260914_100000'), '2) 原有第 1 条仍在（未丢）');
  ok(ids && ids[0].id === '20260914_100000', '2) 老卡片顺序保持在前');

  /* ------------------------------ 3. 结构不一致：备份 + 重建 + 旧灵感全在 */
  const idxPath = path.join(A, '.xin-ideas', 'index.html');
  // 模拟旧模板：卡片是 <a class="card">、且不含 c-link 结构标记
  const oldHtml = fs.readFileSync(idxPath, 'utf8')
    .replace(/c-link/g, 'clink')               // 彻底抹掉新结构标记（别留 c-link 子串）
    .replace(/<div class="card/g, '<a class="card');
  fs.writeFileSync(idxPath, oldHtml, 'utf8');
  r = run(A, '--detail', writeJson(TMPJSON, 'a3.json', idea(3, '灵感丙')), '--ts', '20260914_120000');
  ids = readIndexIds(A);
  const bak = idxPath + '.bak';
  const hasBak = fs.existsSync(bak);
  ok(hasBak, '3) 结构不一致 → 已生成 index.html.bak', r.out.trim());
  ok(r.code === 0 && ids && ids.length === 3, '3) 重建后 3 条齐全', r.out.trim());
  ok(ids && ids.some(x => x.id === '20260914_100000') && ids.some(x => x.id === '20260914_110000'),
    '3) 重建后前两条旧灵感一条没丢');
  ok(hasBak && fs.readFileSync(bak, 'utf8').includes('20260914_100000'), '3) 备份文件里含旧内容');

  /* ---------------------- 4. 再次结构不一致：不覆盖已存在的 .bak */
  const nowHtml = fs.readFileSync(idxPath, 'utf8').replace(/c-link/g, 'clink');
  fs.writeFileSync(idxPath, nowHtml, 'utf8');
  r = run(A, '--detail', writeJson(TMPJSON, 'a4.json', idea(4, '灵感丁')), '--ts', '20260914_130000');
  const baks = fs.readdirSync(path.dirname(idxPath)).filter(f => f.startsWith('index.html.bak'));
  ok(baks.length === 2, '4) 不覆盖旧 .bak，改用带时间戳的新备份（现共 ' + baks.length + ' 个）', baks.join(', '));
  ids = readIndexIds(A);
  ok(ids && ids.length === 4, '4) 四轮追加后共 4 条，无丢失');

  /* --------------------------------- 5. 明细页已存在 → 拒绝覆盖 */
  r = run(A, '--detail', writeJson(TMPJSON, 'a5.json', idea(9, '不该覆盖的')), '--ts', '20260914_100000');
  const detailPath = path.join(A, '.xin-ideas', 'ideas', 'idea_20260914_100000.html');
  ok(r.code !== 0, '5) 明细页已存在 → 拒绝覆盖（退出码 ' + r.code + '）');
  ok(fs.readFileSync(detailPath, 'utf8').includes('灵感甲'), '5) 原明细页内容未被改动');

  /* --------------------------- 6. --force → 先备份再覆盖 */
  r = run(A, '--detail', writeJson(TMPJSON, 'a6.json', idea(9, '显式覆盖版')), '--ts', '20260914_100000', '--force');
  ok(r.code === 0 && fs.existsSync(detailPath + '.bak'), '6) --force → 生成 .bak 备份');
  ok(fs.readFileSync(detailPath, 'utf8').includes('显式覆盖版'), '6) 新内容已写入');

  /* ------------------------------- 7. 孤儿明细页 → 自动补回索引 */
  const B = path.join(ROOT, 'caseB');
  fs.mkdirSync(path.join(B, '.xin-ideas', 'ideas'), { recursive: true });
  // 手工放一个明细页，但不建索引
  fs.copyFileSync(path.join(__dirname, '..', 'assets', 'templates', 'detail.html'),
    path.join(B, '.xin-ideas', 'ideas', 'idea_20260914_140000.html'));
  // 给它灌一个 IDEA（直接改文件里的 IDEA 块）
  const orphanPath = path.join(B, '.xin-ideas', 'ideas', 'idea_20260914_140000.html');
  const oh = fs.readFileSync(orphanPath, 'utf8').replace(/const\s+IDEA\s*=\s*\{[\s\S]*?\n\};/,
    'const IDEA = ' + JSON.stringify(idea(7, '孤儿灵感'), null, 2) + ';');
  fs.writeFileSync(orphanPath, oh, 'utf8');
  r = run(B, '--detail', writeJson(TMPJSON, 'b1.json', idea(8, '新来的')), '--ts', '20260914_150000');
  ids = readIndexIds(B);
  ok(r.code === 0 && ids && ids.length === 2, '7) 孤儿明细页被补回索引（2 条）', r.out.trim());
  ok(ids && ids.some(x => x.id === '20260914_140000'), '7) 孤儿条目（孤儿灵感）已在索引中');

  /* -------------------------------------- 8. --dry-run 不落盘 */
  const C = path.join(ROOT, 'caseC');
  fs.mkdirSync(C, { recursive: true });
  r = run(C, '--detail', writeJson(TMPJSON, 'c1.json', idea(5, '预览用')), '--ts', '20260914_160000', '--dry-run');
  ok(r.code === 0 && !fs.existsSync(path.join(C, '.xin-ideas', 'index.html')),
    '8) --dry-run → 未创建 index.html');
  ok(!fs.existsSync(path.join(C, '.xin-ideas', 'ideas', 'idea_20260914_160000.html')),
    '8) --dry-run → 未创建明细页');

  /* ------------------------------ 9. 生成的索引可被模板正常渲染 */
  const htmlA = fs.readFileSync(idxPath, 'utf8');
  const mIdeas = htmlA.match(/const\s+IDEAS\s*=\s*(\[[\s\S]*?\n\];)/);
  ok(/c-link/.test(htmlA), '9) 合并后的索引为新模板结构（含 a.c-link）');
  ok(!!mIdeas && !/undefined/.test(mIdeas[1]), '9) IDEAS 数组本体无 undefined 残留');
  ok(!!mIdeas && eval('(' + mIdeas[1].replace(/;\s*$/, '') + ')').every(x => x.file && x.id),
    '9) 每条都有 id 与 file（点开不会 404）');
  /* ------------- 10. --sync-pages：模板升级后同步存量明细页，IDEA 数据必须不丢 ------------- */
  const D = path.join(ROOT, 'caseD');
  fs.mkdirSync(D, { recursive: true });
  run(D, '--detail', writeJson(TMPJSON, 'd1.json', idea(6, '待同步的灵感')), '--ts', '20260914_170000');
  const dp = path.join(D, '.xin-ideas', 'ideas', 'idea_20260914_170000.html');

  // 把该页的「模板部分」人为改旧：去掉浮动按钮、关闭按钮与其脚本
  let dh = fs.readFileSync(dp, 'utf8');
  const ideaBefore = (dh.match(/const\s+IDEA\s*=\s*\{[\s\S]*?\n\};/) || [''])[0];
  dh = dh.replace(/<!-- 返回顶部[\s\S]*?<\/button>/, '')
         .replace(/<div class="foot-nav">[\s\S]*?<\/div>/, '<a class="back" href="../index.html">← 返回灵感库</a>')
         .replace(/\n\/\* ============ 关闭本页[\s\S]*?<\/script>/, '\n</script>');
  fs.writeFileSync(dp, dh, 'utf8');
  ok(!/id="toTop"/.test(dh), '10) 已把明细页人为改旧（无浮动按钮）');

  r = run(D, '--sync-pages');
  dh = fs.readFileSync(dp, 'utf8');
  const ideaAfter = (dh.match(/const\s+IDEA\s*=\s*\{[\s\S]*?\n\};/) || [''])[0];
  ok(r.code === 0 && /id="toTop"/.test(dh) && /id="closeCard"/.test(dh) && /foot-nav/.test(dh),
    '10) --sync-pages 已把明细页对齐到当前模板', r.out.trim());
  ok(ideaAfter.length > 50 && ideaAfter === ideaBefore, '10) 同步后 IDEA 数据逐字未变（内容没丢）');
  ok(fs.existsSync(dp + '.bak'), '10) 同步前已备份 .bak');

  r = run(D, '--sync-pages');
  const baks10 = fs.readdirSync(path.dirname(dp)).filter(f => f.includes('.bak'));
  ok(r.code === 0 && baks10.length === 1, '10) 再次同步幂等（不重复备份，仍 ' + baks10.length + ' 个 .bak）', baks10.join(', '));

  const idsD = readIndexIds(D);
  ok(Array.isArray(idsD) && idsD.length === 1 && idsD[0].id === '20260914_170000',
    '10) 同步明细页不影响索引（仍 1 条）');

  /* ------------- 11. --sync-index：列表页模板升级后同步，IDEAS 数据必须一条不丢 ------------- */
  const idxPathD = path.join(D, '.xin-ideas', 'index.html');
  const idsD0 = JSON.stringify(readIndexIds(D));
  // 把列表页的「模板部分」人为改旧：抹掉新版 CSS 标记（模拟旧模板）
  let ih = fs.readFileSync(idxPathD, 'utf8').replace(/\.c-score-none\{[^}]*\}/, '');
  fs.writeFileSync(idxPathD, ih, 'utf8');
  // 注意：c-score-none 在文件里出现两次（CSS 定义 + 渲染逻辑），这里只删了定义，断言要瞄准定义本身
  ok(!/\.c-score-none\{/.test(fs.readFileSync(idxPathD, 'utf8')), '11) 已把列表页人为改旧（CSS 定义被移除）');

  r = run(D, '--sync-index');
  const ih2 = fs.readFileSync(idxPathD, 'utf8');
  ok(r.code === 0 && /\.c-score-none\{/.test(ih2), '11) --sync-index 已把列表页对齐到当前模板', r.out.trim());
  ok(JSON.stringify(readIndexIds(D)) === idsD0, '11) 同步后 IDEAS 数据逐字未变（条目没丢）');
  ok(fs.existsSync(idxPathD + '.bak'), '11) 同步前已备份 index.html.bak');

  r = run(D, '--sync-index');
  const ibaks = fs.readdirSync(path.dirname(idxPathD)).filter(f => f.startsWith('index.html.bak'));
  ok(r.code === 0 && ibaks.length === 1, '11) 再次同步幂等（不重复备份，仍 ' + ibaks.length + ' 个）', ibaks.join(', '));
} finally {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* 忽略清理失败 */ }
}

console.log(`\n通过 ${passed} / 失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
