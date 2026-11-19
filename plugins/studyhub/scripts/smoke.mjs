/**
 * 宿主半边的冒烟测试：假 cordis ctx，不需要模型、不需要 GUI、不拉起 Python。
 *
 *   node scripts/smoke.mjs
 *
 * 覆盖：路由注册 / status JSON 形状 / selfcheck 回写 / log 路由 / 404 / 配置兜底。
 */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'studyhub-smoke-'));
process.env.DSH_HOME = tmpHome;

const mod = await import('../index.js');
assert.equal(mod.name, 'studyhub', '插件名');

const routes = new Map();
const toolDefs = new Map();
const effects = [];
const fakeTools = {
  register(definition) {
    toolDefs.set(definition.name, definition);
    return () => toolDefs.delete(definition.name);
  },
};
const ctx = {
  effect(fn, label) {
    const disposer = fn();
    effects.push({ label, disposer });
    return disposer;
  },
  get(name) {
    if (name === 'webServer') {
      return {
        register(route) {
          routes.set(route.path, route);
          return () => routes.delete(route.path);
        },
      };
    }
    if (name === 'tools') return fakeTools;
    return undefined;
  },
};

const api = mod.apply(ctx, { autoStart: false, logDir: path.join(tmpHome, 'logs') });

const makeReq = (url, method = 'GET', body = null) => {
  const req = new Readable({ read() {} });
  req.url = url;
  req.method = method;
  if (body !== null) req.push(JSON.stringify(body));
  req.push(null);
  return req;
};

const makeRes = () => {
  const res = {
    statusCode: 0,
    headers: {},
    chunks: [],
    writeHead(code, headers) {
      res.statusCode = code;
      Object.assign(res.headers, headers || {});
      return res;
    },
    end(chunk) {
      if (chunk !== undefined) res.chunks.push(String(chunk));
      res.finished = true;
    },
  };
  res.json = () => JSON.parse(res.chunks.join('') || 'null');
  return res;
};

const call = async (sub, method = 'GET', body = null) => {
  const route = routes.get('/studyhub');
  assert.ok(route, '/studyhub 路由已注册');
  assert.equal(route.kind, 'prefix', '路由类型是 prefix');
  const res = makeRes();
  await route.handler(makeReq(`/studyhub${sub}`, method, body), res);
  return { status: res.statusCode, json: res.json() };
};

/* 1. 路由注册 */
assert.equal(routes.size, 1, `注册了 1 条路由，实际 ${routes.size}`);
assert.equal(effects.length, 1, '注册了 1 个 lifecycle effect');

/* 1b. 只读 + 管理工具 */
{
  const expected = [
    'study_lang_install', 'study_lang_list', 'study_lang_remove',
    'study_outline', 'study_py_clear', 'study_py_install', 'study_py_list',
    'study_read', 'study_search', 'study_tree',
  ];
  assert.deepEqual(
    [...toolDefs.keys()].sort(),
    expected,
    `注册了 ${toolDefs.size} 个工具，实际 ${[...toolDefs.keys()].sort().join(', ')}`,
  );
  for (const [name, def] of toolDefs) {
    assert.equal(def.parameters.type, 'object', `${name}: 参数根是 object`);
    assert.ok(def.parameters.properties && typeof def.parameters.properties === 'object', `${name}: 有 properties`);
    if (def.parameters.required !== undefined) {
      assert.ok(Array.isArray(def.parameters.required), `${name}: required 是数组`);
    }
    assert.equal(def.parameters.additionalProperties, false, `${name}: 关掉 additionalProperties`);
    assert.equal(typeof def.execute, 'function', `${name}: 有 execute`);
    assert.equal(typeof def.output?.render, 'function', `${name}: 有 output.render`);
  }
  console.log('  · 4 个工具 schema OK');
}

/* 2. status */
{
  const { status, json } = await call('/status');
  assert.equal(status, 200, 'status 返回 200');  assert.equal(json.ok, true);
  assert.equal(json.plugin, 'dsh-studyhub');
  assert.ok(['idle', 'offline', 'online', 'starting', 'error'].includes(json.phase), `phase 合法：${json.phase}`);
  assert.equal(typeof json.config.platformDir, 'string');
  assert.equal(json.config.port, 8777, '默认端口');
  assert.equal(typeof json.config.serverEntryExists, 'boolean');
  assert.equal(typeof json.dsh.capabilities.webServer, 'boolean');
  assert.equal(json.dsh.capabilities.webServer, true, 'webServer 能力被探测到');
  assert.equal(json.dsh.registrations.routes, true);
  assert.ok(Array.isArray(json.logTail), 'logTail 是数组');
  // 平台此刻可能开着，也可能没开 —— 两种都算合格，但 online 时必须给 url
  if (json.online) {
    assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/$/.test(json.url), `online 时 url 合法：${json.url}`);
    assert.ok(json.port >= 8777, `port 落在扫描区间：${json.port}`);
  }
  console.log(`  · status: phase=${json.phase} url=${json.url ?? '-'} dsh=${json.dsh.version ?? 'unknown'}`);
}

/* 3. selfcheck 回写 */
{
  const before = await call('/status');
  assert.equal(before.json.clientReport, null, '初始无客户端自检');
  const post = await call('/selfcheck', 'POST', { ok: ['main', 'sidebar.panellist'], errors: [] });
  assert.equal(post.status, 200);
  const after = await call('/status');
  assert.ok(after.json.clientReport, '客户端自检被记录');
  assert.deepEqual(after.json.clientReport.ok, ['main', 'sidebar.panellist']);
  assert.ok(after.json.clientReport.receivedAt, '带接收时间');
}

/* 4. log */
{
  const { status, json } = await call('/log');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.lines) && json.lines.length > 0, '日志里有内容');
  assert.ok(json.file.endsWith('server.log'), `日志文件路径：${json.file}`);
}

/* 5. 未知路由 */
{
  const { status, json } = await call('/nope');
  assert.equal(status, 404);
  assert.equal(json.ok, false);
}

/* 6. 配置兜底：非法 port / span 回落默认 */
{
  const routes2 = new Map();
  const ctx2 = {
    effect: () => () => {},
    get: () => ({ register: (r) => { routes2.set(r.path, r); return () => {}; } }),
  };
  mod.apply(ctx2, { port: 'abc', span: 999, autoStart: false, logDir: path.join(tmpHome, 'logs2') });
  const res = makeRes();
  await routes2.get('/studyhub').handler(makeReq('/studyhub/status'), res);
  const json = res.json();
  assert.equal(json.config.port, 8777, '非法 port 回落 8777');
  console.log('  · 配置兜底 OK');
}

/* 7. 没有 webServer 时降级（不能抛） */
{
  const ctx3 = { effect: () => () => {}, get: () => undefined };
  const api3 = mod.apply(ctx3, { autoStart: false, logDir: path.join(tmpHome, 'logs3') });
  assert.ok(api3 && typeof api3.status === 'function');
  const status = api3.status();
  assert.equal(status.dsh.capabilities.webServer, false);
  assert.equal(status.dsh.capabilities.tools, false, 'tools 缺席也被记录');
  assert.ok(status.dsh.errors.some((line) => line.includes('webServer')), '把缺失的 webServer 记进 errors');
  console.log('  · 无 webServer 降级 OK');
}

/* 8. shut down + 清理 */
await api.shutdown();
for (const effect of effects) effect.disposer?.();
// 让日志流的句柄先释放，再删临时目录（日志流本身已吞掉所有 error）
await new Promise((resolve) => setTimeout(resolve, 80));
fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n[smoke] 全部通过');
