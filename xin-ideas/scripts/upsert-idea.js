#!/usr/bin/env node
/* ============================================================================
 * xin-ideas 灵感墙「增量写入 / 防覆盖」合并器
 * ----------------------------------------------------------------------------
 * 铁律：**永不覆盖、永不丢失已有灵感**。
 *
 * 它负责三件最容易被手抖搞砸的事：
 *   1) 明细页    —— 目标文件已存在时拒绝覆盖（除非显式 --force，且 force 前先备份 .bak）
 *   2) 列表页    —— 已存在则「增量合并」：原有条目一条不动，只追加/更新新条目
 *   3) 结构不一致 —— 先把原 index.html 备份为 index.html.bak（已有 .bak 时改用带时间戳的
 *                    名字，绝不覆盖旧备份），再用新模板重建，并把旧索引 + ideas/ 目录里
 *                    能捞到的全部灵感重新写回。明细页是权威数据源，所以索引坏了也能恢复。
 *
 * 用法：
 *   node scripts/upsert-idea.js --base "<baseDir>" --detail <idea.json> [--ts YYYYMMDD_HHMMSS]
 *       写入一个完整灵感：生成明细页 + 合并进索引。
 *       idea.json 是一个完整 IDEA 对象（title/scores/details/pros/... 见 detail.html 模板注释）。
 *
 *   node scripts/upsert-idea.js --base "<baseDir>" --entry <entry.json>
 *       只更新索引（不生成明细页）。entry.json 形如：
 *       { "id":"20260914_142000", "title":"…", "ts":"2026-09-14 14:20", "tags":["…"],
 *         "score":7.5, "summary":"…", "origin":"…", "file":"ideas/idea_20260914_142000.html" }
 *
 *   node scripts/upsert-idea.js --base "<baseDir>" --rebuild
 *       扫描 ideas/ 目录重建索引（不新增内容）。索引损坏或结构不一致时用。
 *
 *   node scripts/upsert-idea.js --base "<baseDir>" --sync-pages
 *       把 ideas/ 里已有的明细页对齐到当前 detail.html 模板（模板升级后用）。
 *       用「当前模板外壳 + 本页原有 IDEA 数据」重建，IDEA 数据逐字保留；
 *       有差异才动手，且先备份为 <文件>.bak。
 *
 *   node scripts/upsert-idea.js --base "<baseDir>" --sync-index
 *       把已有的 index.html 对齐到当前列表页模板（列表页模板升级后用）——
 *       注意 --rebuild 在「结构一致」时只做增量合并、不会更新模板 CSS/JS，故模板升级要靠本命令。
 *       用「当前模板外壳 + 现有 IDEAS 数据」重建，灵感条目逐字保留；先备份 index.html.bak。
 *
 *   node scripts/upsert-idea.js --base "<baseDir>" --status
 *       体检：索引条目 vs 明细页文件的对应关系（404 / 孤儿）。
 *
 * 通用参数：
 *   --base <dir>   灵感墙根目录（.xin-ideas 建在其下）。省略则读 skill 根 config.json 的 baseDir。
 *   --dry-run      只报告将发生什么，不落盘。
 *   --force        允许覆盖已存在的明细页（覆盖前自动备份为 <file>.bak）。
 *
 * 退出码：0 成功 / 1 出错 / 2 用法或配置问题（如 baseDir 未指定，需先询问用户）。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SKILL_DIR = path.join(__dirname, '..');
const TPL = name => path.join(SKILL_DIR, 'assets', 'templates', name);

/* ---------------------------------------------------------------- 参数解析 */
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const next = argv[i + 1];
      if (k === 'dry-run' || k === 'force' || k === 'rebuild' || k === 'status' || k === 'sync-pages' || k === 'sync-index' || k === 'help') {
        a[k] = true;
      } else {
        a[k] = next; i++;
      }
    } else a._.push(t);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

function usage() {
  console.log([
    'xin-ideas 合并器（不覆盖 / 不丢失）',
    '',
    '  node scripts/upsert-idea.js --base "<baseDir>" --detail <idea.json> [--ts YYYYMMDD_HHMMSS]',
    '  node scripts/upsert-idea.js --base "<baseDir>" --entry  <entry.json>',
    '  node scripts/upsert-idea.js --base "<baseDir>" --rebuild',
    '  node scripts/upsert-idea.js --base "<baseDir>" --sync-pages',
    '  node scripts/upsert-idea.js --base "<baseDir>" --sync-index',
    '  node scripts/upsert-idea.js --base "<baseDir>" --status',
    '',
    '  可选：--dry-run 预览不落盘  /  --force 允许覆盖明细页（先备份 .bak）'
  ].join('\n'));
}

/* ------------------------------------------------------------------ 基础件 */
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function readBase(explicit) {
  if (explicit) return path.resolve(explicit);
  const cfg = path.join(SKILL_DIR, 'config.json');
  if (fs.existsSync(cfg)) {
    try {
      const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      if (j && j.baseDir) return path.resolve(j.baseDir);
    } catch (e) { /* 配置坏了 → 当作未指定处理，交给上层询问 */ }
  }
  return null;
}

/** 在沙箱里求值一段 JS 字面量，失败返回 null —— 不抛，避免一个坏文件拖垮整轮。 */
/** 读取 skill 根 config.json（baseDir / theme 等）。读取失败返回 {}。 */
function readConfig() {
  const cfg = path.join(SKILL_DIR, 'config.json');
  try {
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    return (j && typeof j === 'object') ? j : {};
  } catch (e) { return {}; }
}

/** 把模板里的默认色调占位（window.__XIN_DEFAULT_THEME__ = "..."）替换为 config.json 的 theme。
   仅在 theme 有值时替换；缺省则保留模板内置默认，不强行改写。 */
function applyTheme(html, theme) {
  if (!theme) return html;
  return html.replace(/window\.__XIN_DEFAULT_THEME__\s*=\s*["'][^"']*["']/, `window.__XIN_DEFAULT_THEME__ = "${theme}"`);
}

/** 取默认色调：config.json 的 theme 字段；缺省返回 undefined（由模板内置默认接管）。 */
function defaultTheme() {
  const c = readConfig();
  return c.theme;
}

function evalLiteral(code, label) {
  try {
    return vm.runInNewContext('(' + code + ')', Object.create(null), { timeout: 3000 });
  } catch (e) {
    console.log(`  warn  ${label} 解析失败，已跳过：${e.message}`);
    return null;
  }
}

function extract(html, re) {
  const m = html.match(re);
  if (!m) return null;
  return m[1].replace(/;\s*$/, '');
}

const RE_IDEAS = /const\s+IDEAS\s*=\s*(\[[\s\S]*?\n\];)/;
const RE_IDEA = /const\s+IDEA\s*=\s*(\{[\s\S]*?\n\};)/;

function parseIdeas(html) {
  const code = extract(html, RE_IDEAS);
  if (!code) return null;
  const v = evalLiteral(code, 'index.html 的 IDEAS');
  return Array.isArray(v) ? v : null;
}

function parseDetail(html) {
  const code = extract(html, RE_IDEA);
  if (!code) return null;
  return evalLiteral(code, '明细页的 IDEA');
}

/** 判断索引页是否为「当前模板结构」：有 IDEAS 数组 + 卡片正文锚点 a.c-link。 */
function isCurrentStructure(html) {
  return /const\s+IDEAS\s*=/.test(html) && /c-link/.test(html);
}

function meanScore(scores) {
  if (!scores || typeof scores !== 'object') return null;
  const v = Object.values(scores).filter(x => typeof x === 'number' && isFinite(x));
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

/** 明细页 IDEA 对象 → 索引条目 */
function detailToEntry(idea, file) {
  const id = (file.match(/idea_([0-9_]+)\.html$/) || [])[1];
  return {
    id: id,
    title: idea.title,
    ts: idea.ts,
    tags: idea.tags,
    score: (typeof idea.score === 'number') ? idea.score : meanScore(idea.scores),
    summary: idea.summary,
    origin: idea.origin,
    file: file
  };
}

/** 扫描 ideas/ 下所有明细页，作为权威数据源（索引丢了也能靠它恢复） */
function scanDetails(dir) {
  const entries = [], broken = [];
  if (!fs.existsSync(dir)) return { entries, broken };
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/^idea_.*\.html$/.test(f)) continue;
    const idea = parseDetail(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!idea) { broken.push(f); continue; }
    const e = detailToEntry(idea, 'ideas/' + f);
    if (e.id) entries.push(e);
  }
  return { entries, broken };
}

/* -------------------------------------------------------------- 合并核心 */
const isBlank = v => v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0);

/** base 为底，over 中的「非空」字段覆盖上去 —— 非空覆盖保证不丢已有信息。 */
function mergeObj(base, over) {
  const r = Object.assign({}, base);
  if (over) for (const k of Object.keys(over)) if (!isBlank(over[k])) r[k] = over[k];
  return r;
}

/**
 * 三层合并，优先级：新条目 > 旧索引 > 明细页扫描。
 * 顺序：旧索引原有顺序在前（老卡片位置不变），明细页独有与新增条目依次追加在后。
 */
function mergeAll(dirEntries, oldEntries, newEntry) {
  const map = new Map(), order = [];
  const ensure = id => {
    if (!map.has(id)) { map.set(id, {}); order.push(id); }
    return map.get(id);
  };
  // 1) 顺序骨架：先按旧索引顺序，老卡片位置保持不变
  (oldEntries || []).forEach(it => { if (it && it.id) ensure(it.id); });
  // 2) 低优先：明细页扫描（只补旧索引缺失的条目）
  (dirEntries || []).forEach(it => {
    if (!it || !it.id) return;
    map.set(it.id, mergeObj(it, ensure(it.id)));
  });
  // 3) 中优先：旧索引里的条目（可能含手工补过的 origin 等，保留）
  (oldEntries || []).forEach(it => {
    if (!it || !it.id) return;
    map.set(it.id, mergeObj(map.get(it.id), it));
  });
  // 4) 高优先：本次新增 / 更新的条目
  if (newEntry && newEntry.id) map.set(newEntry.id, mergeObj(ensure(newEntry.id), newEntry));

  return order.map(id => map.get(id)).filter(o => o && o.id);
}

function renderIdeas(arr) {
  // 用 JSON.stringify 落盘：天然把字符串里的换行转义成 \n，不会写出裸换行导致 JS 语法错误
  return 'const IDEAS = ' + JSON.stringify(arr, null, 2) + ';';
}

function replaceIdeasBlock(html, arr) {
  if (!RE_IDEAS.test(html)) throw new Error('目标文件中找不到 IDEAS 数组，无法写入');
  return html.replace(RE_IDEAS, renderIdeas(arr).replace(/\$/g, '$$$$'));
}

/** 备份文件：绝不覆盖已存在的备份 —— 已有 .bak 就用 index.html.bak.<时间戳>。 */
function backupFile(file, dry) {
  let bak = file + '.bak';
  if (fs.existsSync(bak)) bak = file + '.bak.' + stamp();
  if (!dry) fs.copyFileSync(file, bak);
  return bak;
}

function writeFileSafe(file, content) {
  // 显式 utf8 + LF：Node 不做换行转换，保持与模板一致
  fs.writeFileSync(file, content, { encoding: 'utf8' });
}

/* ------------------------------------------------------------ 主流程：索引 */
function ensureIndex(base, newEntry, opts) {
  const XIN = path.join(base, '.xin-ideas');
  const IDX = path.join(XIN, 'index.html');
  const DIR = path.join(XIN, 'ideas');
  const log = [];

  if (!opts.dry) fs.mkdirSync(DIR, { recursive: true });

  const tplIndex = applyTheme(fs.readFileSync(TPL('index.html'), 'utf8'), defaultTheme());
  const { entries: dirEntries, broken } = scanDetails(DIR);
  if (broken.length) {
    log.push(`warn 这些明细页解析失败、已跳过（文件未改动）：${broken.join(', ')}`);
  }

  // —— 情形 A：索引不存在 → 用模板新建，直接灌入明细页扫描 + 新条目
  if (!fs.existsSync(IDX)) {
    const arr = mergeAll(dirEntries, [], newEntry);
    if (!opts.dry) writeFileSafe(IDX, replaceIdeasBlock(tplIndex, arr));
    log.push(`索引不存在 → 新建 ${IDX}（写入 ${arr.length} 条${opts.dry ? '，dry-run 未落盘' : ''}）`);
    return { log, mode: 'create', count: arr.length, arr };
  }

  const html = fs.readFileSync(IDX, 'utf8');
  const oldArr = parseIdeas(html);
  const oldCount = oldArr ? oldArr.length : null;

  // —— 情形 B：结构一致 → 增量合并，原有条目一条不动
  if (oldArr && isCurrentStructure(html)) {
    const arr = mergeAll(dirEntries, oldArr, newEntry);
    if (!opts.dry) writeFileSafe(IDX, replaceIdeasBlock(html, arr));
    log.push(`索引结构一致 → 增量合并（原有 ${oldCount} 条全部保留，合计 ${arr.length} 条）`);
    if (dirEntries.length > oldCount) {
      log.push(`  注意：从 ideas/ 目录补回 ${dirEntries.length - oldCount} 条索引缺失的灵感`);
    }
    return { log, mode: 'append', count: arr.length, arr };
  }

  // —— 情形 C：结构不一致（旧模板 / 索引损坏 / 解析不出）→ 备份 + 用新模板重建
  const reason = oldArr ? '索引为旧模板结构' : '索引里的 IDEAS 数组无法解析';
  const bak = backupFile(IDX, opts.dry);
  const arr = mergeAll(dirEntries, oldArr || [], newEntry);
  if (!opts.dry) writeFileSafe(IDX, replaceIdeasBlock(tplIndex, arr));
  log.push(`索引结构不一致（${reason}）→ 原文件已备份为 ${bak}${opts.dry ? '（dry-run 未落盘）' : ''}`);
  log.push(`  已用新模板重建索引，从旧索引${oldCount !== null ? `(+${oldCount} 条)` : ''}与 ideas/ 目录共恢复 ${arr.length} 条灵感`);
  return { log, mode: 'rebuild', count: arr.length, arr, backup: bak };
}

/* --------------------------------------------------------- 主流程：明细页 */
function normTs(s) {
  if (!s) return null;
  const d = String(s).replace(/\D/g, '');
  if (d.length >= 14) return d.slice(0, 8) + '_' + d.slice(8, 14);
  if (d.length === 12) return d.slice(0, 8) + '_' + d.slice(8, 12) + '00';
  return null;
}

function writeDetail(base, idea, ts, opts) {
  const DIR = path.join(base, '.xin-ideas', 'ideas');
  const file = path.join(DIR, `idea_${ts}.html`);
  if (!opts.dry) fs.mkdirSync(DIR, { recursive: true });

  if (fs.existsSync(file)) {
    if (!opts.force) {
      // 不覆盖铁律：默认直接停下，让调用方换个时间戳（或显式要求 force）
      return {
        ok: false,
        file,
        msg: `明细页已存在，拒绝覆盖：${file}\n  处理方式：换一个 --ts，或确认要覆盖时加 --force（覆盖前会自动备份 .bak）`
      };
    }
    const bak = backupFile(file, opts.dry);
    const html = applyTheme(replaceIdeaBlock(fs.readFileSync(TPL('detail.html'), 'utf8'), idea, ts), defaultTheme());
    if (!opts.dry) writeFileSafe(file, html);
    return { ok: true, file, bak, msg: `明细页已存在 → 已备份旧文件为 ${bak}，再写入新内容` };
  }

  const html = applyTheme(replaceIdeaBlock(fs.readFileSync(TPL('detail.html'), 'utf8'), idea, ts), defaultTheme());
  if (!opts.dry) writeFileSafe(file, html);
  return { ok: true, file, msg: `明细页已生成：${file}` };
}

function replaceIdeaBlock(html, idea, ts) {
  const body = 'const IDEA = ' + JSON.stringify(idea, null, 2) + ';';
  if (!RE_IDEA.test(html)) throw new Error('detail.html 模板里找不到 IDEA 对象');
  const out = html.replace(RE_IDEA, body.replace(/\$/g, '$$$$'));
  // 兜底：若 IDEA.ts 没填，用文件名时间戳兜一下
  return out;
}

/* --------------------------------------- 同步存量明细页到当前模板（--sync-pages）
 * 用途：detail.html 模板升级后（加按钮、改样式、补功能），把 ideas/ 里已有的明细页
 *       对齐到新模板 —— 用「当前模板外壳 + 本页原有 IDEA 数据」重建，IDEA 数据逐字保留。
 * 安全：只有在内容确有差异时才动手（已对齐的跳过，不产生多余备份）；
 *       动手前先备份为 <文件>.bak，已有 .bak 则改用带时间戳的名字，绝不覆盖旧备份。
 * --------------------------------------------------------------------------- */
function syncPages(base, opts) {
  const DIR = path.join(base, '.xin-ideas', 'ideas');
  const log = [];
  if (!fs.existsSync(DIR)) {
    log.push('ideas/ 目录不存在，无需同步');
    return { log, changed: 0, same: 0, broken: [] };
  }

  const tpl = applyTheme(fs.readFileSync(TPL('detail.html'), 'utf8'), defaultTheme());
  const broken = [];
  let changed = 0, same = 0;

  for (const f of fs.readdirSync(DIR).sort()) {
    if (!/^idea_.*\.html$/.test(f)) continue;
    const p = path.join(DIR, f);
    const html = fs.readFileSync(p, 'utf8');
    const idea = parseDetail(html);
    if (!idea) { broken.push(f); continue; }

    const expected = replaceIdeaBlock(tpl, idea, null);
    // 只比「模板结构」：把本页 IDEA 块也规范化后再比，避免手写格式差异被误判成落后
    const normalized = replaceIdeaBlock(html, idea, null);
    if (normalized === expected) { same++; continue; }   // 已是最新，跳过

    const bak = backupFile(p, opts.dry);
    if (!opts.dry) writeFileSafe(p, expected);
    changed++;
    log.push(`${f} → 已同步到当前模板（原文件备份为 ${bak}）`);
  }

  if (broken.length) log.push(`warn 解析失败、已跳过（文件未改动）：${broken.join(', ')}`);
  log.push(`合计：同步 ${changed} 个 / 已是最新 ${same} 个 / 跳过 ${broken.length} 个`);
  return { log, changed, same, broken };
}

/* --------------------------------------- 同步存量索引页到当前模板（--sync-index）
 * 用途：index.html 模板升级后（改样式、加交互/字段），把已有索引页对齐到新模板 ——
 *       用「当前模板外壳 + 现有 IDEAS 数据」重建，灵感条目逐字保留。
 * 与 --sync-pages 对称：那个管明细页，这个管列表页。
 * 安全：IDEAS 解析不出来时**拒绝操作**（改用 --rebuild 从明细页恢复，那条路能兜底）；
 *       只在确有差异时动手；动手前备份 index.html.bak（已有则带时间戳，绝不覆盖）。
 * 注意：--rebuild 的「结构一致」判定只认 a.c-link 这类结构标记，感知不到 CSS/JS 升级，
 *       所以列表页模板改动要靠本命令同步。
 * --------------------------------------------------------------------------- */
function syncIndex(base, opts) {
  const idxPath = path.join(base, '.xin-ideas', 'index.html');
  const log = [];
  if (!fs.existsSync(idxPath)) { log.push('索引页不存在，无需同步'); return { log, changed: 0, same: 0 }; }

  const html = fs.readFileSync(idxPath, 'utf8');
  const arr = parseIdeas(html);
  if (!arr) {
    log.push('warn 索引里的 IDEAS 无法解析 → 拒绝同步（避免丢数据）。请改用 --rebuild 从 ideas/ 恢复。');
    return { log, changed: 0, same: 0, refused: true };
  }

  const tplIndex = applyTheme(fs.readFileSync(TPL('index.html'), 'utf8'), defaultTheme());
  const expected = replaceIdeasBlock(tplIndex, arr);
  // 只比「模板结构」：把本页 IDEA 块也规范化后再比，避免条目书写格式差异被误判成落后
  const normalized = replaceIdeasBlock(html, arr);
  if (normalized === expected) {
    log.push(`已是最新（${arr.length} 条），无需同步`);
    return { log, changed: 0, same: arr.length };
  }

  const bak = backupFile(idxPath, opts.dry);
  if (!opts.dry) writeFileSafe(idxPath, expected);
  log.push(`索引页已同步到当前模板（${arr.length} 条灵感逐字保留；原文件备份为 ${bak}）`);
  return { log, changed: 1, same: 0, count: arr.length, backup: bak };
}

/* ---------------------------------------------------------------- 体检模式 */
function statusReport(base) {
  const XIN = path.join(base, '.xin-ideas');
  const IDX = path.join(XIN, 'index.html');
  const DIR = path.join(XIN, 'ideas');
  console.log(`灵感墙根目录：${base}`);
  console.log(`索引页：${IDX}  ${fs.existsSync(IDX) ? '[存在]' : '[缺失]'}`);

  const { entries: dirEntries, broken } = scanDetails(DIR);
  console.log(`明细页：${DIR}  共 ${dirEntries.length} 个可解析${broken.length ? ` / ${broken.length} 个解析失败` : ''}`);

  let oldArr = null;
  if (fs.existsSync(IDX)) {
    const html = fs.readFileSync(IDX, 'utf8');
    oldArr = parseIdeas(html);
    console.log(`索引结构：${isCurrentStructure(html) ? '当前模板（增量合并可用）' : '与当前模板不一致（下次写入会先备份 .bak 再重建）'}`);
    console.log(`索引条目：${oldArr ? oldArr.length : '无法解析'}`);
  }

  if (oldArr) {
    const files = new Set(dirEntries.map(e => e.file));
    let miss = 0;
    for (const it of oldArr) {
      const fp = path.join(XIN, it.file || '');
      const ok = it.file && fs.existsSync(fp);
      if (!ok) miss++;
      console.log(`  ${ok ? '[ok] ' : '[404]'} ${it.id}  ${it.file || '(无 file 字段)'}`);
    }
    const idxIds = new Set(oldArr.map(i => i.id));
    const orphans = dirEntries.filter(e => !idxIds.has(e.id));
    if (orphans.length) {
      console.log(`  孤儿明细页（索引里没有，下次合并会自动补回）：`);
      orphans.forEach(o => console.log(`    + ${o.id}  ${o.file}`));
    }
    console.log(`\n结论：索引 ${oldArr.length} 条，其中 ${miss} 条指向不存在的文件；孤儿 ${orphans.length} 个。`);
  }
}

/* ------------------------------------------------------------------- 入口 */
function main() {
  if (args.help) { usage(); return 0; }

  const base = readBase(args.base);
  if (!base) {
    console.log('NEED_BASE_DIR');
    console.log('未指定灵感墙位置（config.json 里 baseDir 为空）。请先询问用户把 .xin-ideas 建在哪，');
    console.log(`默认建议（本 skill 安装目录）：${SKILL_DIR}`);
    return 2;
  }

  if (args.status) { statusReport(base); return 0; }

  const opts = { dry: !!args['dry-run'], force: !!args.force };

  if (args['sync-pages']) {
    const r = syncPages(base, opts);
    console.log(`[${opts.dry ? 'DRY-RUN ' : ''}sync-pages]`);
    r.log.forEach(l => console.log('  ' + l));
    return 0;
  }

  if (args['sync-index']) {
    const r = syncIndex(base, opts);
    console.log(`[${opts.dry ? 'DRY-RUN ' : ''}sync-index]`);
    r.log.forEach(l => console.log('  ' + l));
    return r.refused ? 1 : 0;
  }

  if (args.rebuild) {
    const r = ensureIndex(base, null, opts);
    console.log(`[${opts.dry ? 'DRY-RUN ' : ''}rebuild]`);
    r.log.forEach(l => console.log('  ' + l));
    return 0;
  }

  if (args.detail) {
    const idea = JSON.parse(fs.readFileSync(path.resolve(args.detail), 'utf8'));
    const ts = args.ts || normTs(idea.ts) || stamp();
    const d = writeDetail(base, idea, ts, opts);
    console.log(`[${opts.dry ? 'DRY-RUN ' : ''}detail]`);
    console.log('  ' + d.msg);
    if (!d.ok) return 1;
    const entry = detailToEntry(Object.assign({}, idea, { ts: idea.ts || humanTs(ts) }), `ideas/idea_${ts}.html`);
    entry.id = ts;
    const r = ensureIndex(base, entry, opts);
    console.log(`[${opts.dry ? 'DRY-RUN ' : ''}index]`);
    r.log.forEach(l => console.log('  ' + l));
    console.log(`\n完成：灵感 ${ts} 已归档${opts.dry ? '（预览）' : ''}。`);
    return 0;
  }

  if (args.entry) {
    const entry = JSON.parse(fs.readFileSync(path.resolve(args.entry), 'utf8'));
    if (!entry.id) { console.log('  error entry.json 缺少 id 字段'); return 1; }
    const r = ensureIndex(base, entry, opts);
    console.log(`[${opts.dry ? 'DRY-RUN ' : ''}index]`);
    r.log.forEach(l => console.log('  ' + l));
    return 0;
  }

  usage();
  return 2;
}

function humanTs(ts) {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : '';
}

try {
  process.exitCode = main();
} catch (e) {
  console.error('出错：' + e.message);
  process.exitCode = 1;
}
