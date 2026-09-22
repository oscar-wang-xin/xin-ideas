#!/usr/bin/env node
/**
 * 灵感墙健康自检（只读脚本，绝不修改任何文件）
 *
 * 用法：
 *   node scripts/health-check.js                # 读 config.json 的 baseDir
 *   node scripts/health-check.js --dir <路径>    # 指定灵感墙根目录
 *   node scripts/health-check.js --baseline      # 额外与 _baseline.json 比对增量
 *
 * 判定原则（重要）：
 *   索引里的 score 是「录入时独立存的展示分」（1 位小数），明细页的 scores 是「评分原始分（8 / 9 / 10 维）」，
 *   两者本就不必严格相等（差 0.05 内属正常取整）。因此本脚本 **不** 拿两者硬比。
 *   硬错误只认四项：①索引能解析 ②条数 1:1 ③id 互相对得上 ④无失效引用 / 标题不一致。
 *
 * 退出码：0 = 健康（或仅提示）；1 = 存在硬错误；2 = 参数 / 环境错误
 */
const fs = require('fs');
const path = require('path');
const cp = require('crypto');
const vm = require('vm');

const C_OK = '\x1b[32m', C_WARN = '\x1b[33m', C_ERR = '\x1b[31m', C_DIM = '\x1b[2m', C_RST = '\x1b[0m';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

/* ---------- 定位灵感墙根目录 ---------- */
let base = arg('--dir');
if (!base) {
  try {
    base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')).baseDir;
  } catch (e) { /* 忽略，下面报错 */ }
}
if (!base) {
  console.error(C_ERR + '找不到 baseDir：config.json 缺失或未配置，请用 --dir <路径> 指定' + C_RST);
  process.exit(2);
}
const rootDir = path.join(base, '.xin-ideas');
const ideasDir = path.join(rootDir, 'ideas');
const indexFile = path.join(rootDir, 'index.html');

if (!fs.existsSync(rootDir)) {
  console.error(C_ERR + '灵感墙目录不存在：' + rootDir + C_RST);
  process.exit(2);
}

/* ---------- 解析器（IDEA 是 JS 字面量，不是 JSON，必须用 vm 求值） ---------- */
function grabIdea(html) {
  const m = html.match(/const IDEA\s*=\s*(\{[\s\S]*?\n\};)/);
  if (!m) return null;
  const ctx = {};
  vm.runInNewContext('IDEA=' + m[1].replace(/;\s*$/, ''), ctx);
  return ctx.IDEA;
}
function grabIdeas(html) {
  const m = html.match(/const IDEAS\s*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) return null;
  const ctx = {};
  vm.runInNewContext('IDEAS=' + m[1], ctx);
  return ctx.IDEAS;
}
const sha256 = f => cp.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/* ---------- 收集明细页 ---------- */
const errors = [], warns = [], infos = [];

if (!fs.existsSync(ideasDir)) {
  errors.push('明细页目录不存在：' + ideasDir);
}
const pageFiles = fs.existsSync(ideasDir)
  ? fs.readdirSync(ideasDir).filter(f => /^idea_.*\.html$/.test(f)).sort()
  : [];

const details = {};
for (const f of pageFiles) {
  const id = f.replace(/^idea_/, '').replace(/\.html$/, '');
  const d = grabIdea(fs.readFileSync(path.join(ideasDir, f), 'utf8'));
  if (!d) { errors.push('明细页无法解析 IDEA 数据块：' + f); continue; }
  details[id] = { data: d, file: f };
}

/* ---------- 收集索引 ---------- */
let indexList = null;
if (!fs.existsSync(indexFile)) {
  errors.push('列表页不存在：' + indexFile);
} else {
  indexList = grabIdeas(fs.readFileSync(indexFile, 'utf8'));
  if (!indexList) errors.push('列表页无法解析 IDEAS 数组');
}
indexList = indexList || [];

/* ---------- 核对 ---------- */
const byId = {};
indexList.forEach(it => {
  if (byId[it.id]) warns.push('索引中 id 重复：' + it.id);
  byId[it.id] = it;
});

for (const [id, { data, file }] of Object.entries(details)) {
  const it = byId[id];
  if (!it) { errors.push('明细页存在但索引缺失：' + id + '（' + file + '）'); continue; }
  if (it.title !== data.title) {
    errors.push('标题不一致：' + id + '\n      索引="' + it.title + '"\n      明细="' + data.title + '"');
  }
  if (!it.file) warns.push('索引条目缺少 file 字段：' + id);

  /* origin 原话双向同步：任一侧有、另一侧空 = 不同步（常见于历史条目后补原话只补了一边） */
  const oIdx = typeof it.origin === 'string' ? it.origin.trim() : '';
  const oDet = typeof data.origin === 'string' ? data.origin.trim() : '';
  if (oIdx && !oDet) warns.push('原话不同步（索引有、明细页缺）：' + id + ' → 把索引里的原话补回明细页 IDEA');
  else if (!oIdx && oDet) warns.push('原话不同步（明细页有、索引缺）：' + id + ' → 把原话补进索引条目');
  else if (oIdx && oDet && oIdx !== oDet) warns.push('原话两边不一致：' + id);
}
for (const it of indexList) {
  if (!details[it.id]) { errors.push('索引指向的明细页不存在：' + it.id + '（' + (it.file || 'file 字段为空') + '）'); continue; }
  if (it.file && !fs.existsSync(path.join(rootDir, it.file))) {
    errors.push('索引 file 路径失效：' + it.id + ' → ' + it.file);
  }
}

/* ---------- 字段完整性（origin 属历史字段，缺失只算提示） ---------- */
const REQUIRED = ['title', 'ts', 'tags', 'scores', 'summary', 'details', 'pros', 'cons', 'risks', 'roadmap', 'avoid', 'metrics', 'cost'];
for (const [id, { data }] of Object.entries(details)) {
  const miss = REQUIRED.filter(k => {
    const v = data[k];
    if (v === undefined || v === null) return true;
    if (Array.isArray(v) && !v.length) return true;
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return true;
    return false;
  });
  if (miss.length) warns.push('字段缺失：' + id + ' → ' + miss.join(', '));
  const noOrigin = !(typeof data.origin === 'string' && data.origin.length);
  if (noOrigin) infos.push('无原话（历史条目，页面自动不渲染角标）：' + id);
  const nScore = Object.keys(data.scores || {}).length;
  if (nScore > 0 && nScore !== 8 && nScore !== 9 && nScore !== 10) warns.push('维度数异常：' + id + ' → ' + nScore + ' 个（应为 8 / 9 / 10）');
  const noFeas = !(data.feasibility && (data.feasibility.tech || data.feasibility.resources || data.feasibility.verdict || data.feasibility.cost_basis));
  if (nScore > 0 && noFeas) infos.push('未做可行性专项评估（历史条目；新建灵感会自动包含）：' + id);
}

/* ---------- 与基线比对 ---------- */
let baselineReport = null;
if (process.argv.includes('--baseline')) {
  const bp = path.join(base, '_baseline.json');
  if (!fs.existsSync(bp)) {
    warns.push('未找到基线文件 _baseline.json，跳过比对');
  } else {
    const bl = JSON.parse(fs.readFileSync(bp, 'utf8'));
    const curIds = Object.keys(details);
    const baseIds = bl.ids || [];
    baselineReport = {
      added: curIds.filter(i => !baseIds.includes(i)),
      removed: baseIds.filter(i => !curIds.includes(i)),
      indexChanged: bl.index_sha ? (sha256(indexFile) !== bl.index_sha) : null,
      pageChanged: [],
      verifiedAt: bl.verified_at || null,
    };
    for (const [f, h] of Object.entries(bl.page_sha || {})) {
      const fp = path.join(ideasDir, f);
      if (fs.existsSync(fp) && sha256(fp) !== h) baselineReport.pageChanged.push(f);
    }
  }
}

/* ---------- 输出 ---------- */
const scored = Object.values(details).filter(d => Object.keys(d.data.scores || {}).length);
const avgOf = d => Object.values(d.data.scores).reduce((a, b) => a + b, 0) / Object.keys(d.data.scores).length;
scored.sort((a, b) => avgOf(b) - avgOf(a));

console.log('灵感墙根目录：' + base);
console.log('列表页：' + indexFile + '  [' + (fs.existsSync(indexFile) ? '存在' : '缺失') + ']');
console.log('明细页：' + ideasDir + '  共 ' + pageFiles.length + ' 个可解析\n');

console.log('== 条目一览（按明细页综合均分降序）==');
if (!scored.length) console.log('  (暂无已评分的灵感)');
scored.forEach(d => {
  const n = Object.keys(d.data.scores).length;
  console.log('  ' + avgOf(d).toFixed(2) + '  ' + d.data.ts + '  ' + (d.data.origin ? '原话✓' : '原话—') + '  ' + d.data.title.slice(0, 34));
});
const unscored = Object.values(details).filter(d => !Object.keys(d.data.scores || {}).length);
unscored.forEach(d => console.log('  未评  ' + d.data.ts + '  ' + d.data.title.slice(0, 34) + C_DIM + '  (轻量记录)' + C_RST));

console.log('\n== 结构核对 ==');
console.log('  明细页 ' + pageFiles.length + ' 条 / 索引 ' + indexList.length + ' 条 → ' +
  (pageFiles.length === indexList.length ? C_OK + '1:1 对齐' + C_RST : C_ERR + '数量不符' + C_RST));

if (baselineReport) {
  console.log('\n== 与基线比对 ==');
  console.log('  基线验证于：' + (baselineReport.verifiedAt || '（未标注）'));
  console.log('  新增条目：' + (baselineReport.added.length ? C_OK + baselineReport.added.join(', ') + C_RST : '无'));
  console.log('  消失条目：' + (baselineReport.removed.length ? C_ERR + baselineReport.removed.join(', ') + C_RST : '无'));
  console.log('  列表页指纹：' + (baselineReport.indexChanged === null ? '基线未记录' : baselineReport.indexChanged ? '已变化（有新写入）' : '未变'));
  console.log('  老明细页被动过：' + (baselineReport.pageChanged.length ? C_WARN + baselineReport.pageChanged.join(', ') + C_RST + C_DIM + '（通常为模板同步所致，需人工确认数据未变）' + C_RST : '无'));
}

if (warns.length) { console.log('\n' + C_WARN + '== 警告 ' + warns.length + ' 条 ==' + C_RST); warns.forEach(w => console.log('  ! ' + w)); }
if (infos.length) { console.log('\n' + C_DIM + '== 提示 ' + infos.length + ' 条 ==' + C_RST); infos.forEach(i => console.log(C_DIM + '  · ' + i + C_RST)); }
if (errors.length) {
  console.log('\n' + C_ERR + '== 硬错误 ' + errors.length + ' 条 ==' + C_RST);
  errors.forEach(e => console.log(C_ERR + '  ✗ ' + e + C_RST));
  console.log('\n' + C_ERR + '结论：存在硬错误，请先修复再写入新灵感。' + C_RST);
  process.exit(1);
}
console.log('\n' + C_OK + '结论：灵感墙健康 —— ' + pageFiles.length + ' 条，索引 1:1 对齐，0 个失效引用，0 个孤儿。' + C_RST);
process.exit(0);
