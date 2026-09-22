#!/usr/bin/env node
/* xin-ideas 模板回归测试
 *
 * 验证两个模板在「字段缺失 / 类型不对」时不崩溃、页面不出现 undefined 字样。
 * 改动 assets/templates/*.html 后务必跑一遍：node scripts/smoke-test.js
 * 退出码 0 = 全部通过；1 = 有断言失败。
 */
const fs = require('fs');
const path = require('path');

const TPL_DIR = path.join(__dirname, '..', 'assets', 'templates');
const DETAIL = process.argv[2] || path.join(TPL_DIR, 'detail.html');
const INDEX = process.argv[3] || path.join(TPL_DIR, 'index.html');

let failed = 0, passed = 0;

function makeStub() {
  const nodes = {};
  const node = id => {
    if (!nodes[id]) nodes[id] = {
      id, value: id === 'sort' ? 'new' : '', innerHTML: '', textContent: '',
      style: {}, dataset: {}, offsetWidth: 48, offsetHeight: 48,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {}, removeEventListener() {}, getAttribute() { return null; },
      setPointerCapture() {}, releasePointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 48, bottom: 48, width: 48, height: 48 }),
      querySelector: () => null, querySelectorAll: () => []
    };
    return nodes[id];
  };
  // 浏览器环境必有 window / document.documentElement / localStorage；
  // 桩里补齐列表页与明细页用到的滚动、媒体查询、事件监听、指针拖拽等 API。
  const win = {
    innerWidth: 1200, innerHeight: 800, scrollY: 0,
    matchMedia: q => ({ matches: /hover:\s*hover/.test(q) }),
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, close() {}
  };
  return {
    document: {
      title: '', addEventListener() {}, getElementById: node,
      querySelector: () => null, querySelectorAll: () => [],
      documentElement: { scrollTop: 0, setAttribute() {}, getAttribute() { return null; } }, body: { scrollTop: 0 }
    },
    window: win,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: '', replace() {}, assign() {} },
    requestAnimationFrame: () => {},
    get nodes() { return nodes; }
  };
}

function run(label, file, outputId, mutate, opts) {
  opts = opts || {};
  let code = [...fs.readFileSync(file, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).join('\n');
  if (mutate) code = mutate(code);
  const stub = makeStub();
  global.document = stub.document;
  global.requestAnimationFrame = stub.requestAnimationFrame;
  global.window = stub.window;
  global.localStorage = stub.localStorage;
  try {
    eval(code);
    const out = (stub.nodes[outputId] && stub.nodes[outputId].innerHTML) || '';
    const problems = [];
    if (/undefined/.test(out)) problems.push('输出里出现 undefined');
    (opts.contains || []).forEach(t => { if (!out.includes(t)) problems.push(`缺少「${t}」`); });
    (opts.notContains || []).forEach(t => { if (out.includes(t)) problems.push(`不该出现「${t}」`); });
    if (problems.length) { failed++; console.log(`  FAIL  ${label}  —— ${problems.join('；')}`); }
    else { passed++; console.log(`  ok    ${label}  (${out.length}B)`); }
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${label}  —— ${e.constructor.name}: ${e.message}`);
  }
}

console.log('detail.html');
run('正常数据', DETAIL, 'app', null);
run('缺 summary', DETAIL, 'app', c => c.replace(/\n\s*summary:\s*"[^"]*",/, '\n'));
run('缺 tags', DETAIL, 'app', c => c.replace(/\n\s*tags:\s*\[[^\]]*\],/, '\n'));
run('缺 cost', DETAIL, 'app', c => c.replace(/cost:\s*\{[\s\S]*?\n\s*\},/, ''));
run('scores 只剩 6 维', DETAIL, 'app', c => c.replace(/"变现可能": 7, "技术方案": 7,/, ''));
/* 未评分是「轻量记录」的正常状态，不是异常：不得报「维度数异常」红条 */
run('scores 为空（未评分）', DETAIL, 'app',
  c => c.replace(/scores:\s*\{[\s\S]*?\n\s*\},/, 'scores: {},'),
  { contains: ['未评分', '未做体检'], notContains: ['维度数异常'] });

console.log('index.html');
const inj = obj => c => c.replace('const IDEAS = [', 'const IDEAS = [' + obj + ',');
const FULL = '{id:"x",title:"标题",ts:"2026-01-01 00:00",tags:["a"],score:7.5,summary:"摘要",file:"ideas/x.html"}';
run('空数组', INDEX, 'grid', null);
run('1 条 · 字段完整', INDEX, 'grid', inj(FULL));
run('1 条 · 缺 tags', INDEX, 'grid', inj('{id:"x",title:"标题",ts:"t",score:7.5,summary:"摘要",file:"f"}'));
run('1 条 · 缺 summary', INDEX, 'grid', inj('{id:"x",title:"标题",ts:"t",tags:["a"],score:7.5,file:"f"}'));
run('1 条 · score 是字符串', INDEX, 'grid', inj('{id:"x",title:"标题",ts:"t",tags:["a"],score:"7.5",summary:"摘要",file:"f"}'));
/* 未评分（没写 score）：卡片显示「未评」，不得显示 0.0（会被误读成最低分） */
run('1 条 · 未评分（score 缺失）', INDEX, 'grid',
  inj('{id:"x",title:"标题",ts:"t",tags:["a"],summary:"摘要",file:"f"}'),
  { contains: ['未评'], notContains: ['0.0'] });
run('1 条 · score 显式为 null', INDEX, 'grid',
  inj('{id:"x",title:"标题",ts:"t",tags:["a"],score:null,summary:"摘要",file:"f"}'),
  { contains: ['未评'], notContains: ['0.0'] });

console.log(`\n通过 ${passed} / 失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
