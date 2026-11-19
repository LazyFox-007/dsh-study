/**
 * 临时联调：真拉起 Python 服务，确认 start / waitForPorts / stop 这条链路。
 *   node scripts/live-test.mjs
 * 跑完会把自己拉起的那个进程杀掉（外部已在跑的不动）。
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { probePort } from '../lib/platform.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studyhub-live-'));
process.env.DSH_HOME = home;

const mod = await import('../index.js');

const ctx = {
  effect: () => () => {},
  get: () => undefined, // 不注册路由，只测进程生命周期
};

const api = mod.apply(ctx, { autoStart: false, logDir: path.join(home, 'logs') });

console.log('— ensure(true) —');
const t0 = Date.now();
await api.ensure(true);
const status = api.status();
console.log(`  用时 ${Date.now() - t0}ms  phase=${status.phase} url=${status.url ?? '-'} pid=${status.pid ?? '-'} external=${status.external}`);
if (status.error) console.log('  error:', status.error);
if (status.logTail?.length) console.log('  日志尾部:\n    ' + status.logTail.slice(-6).join('\n    '));

const up = await probePort(8777);
console.log('— /api/ping —');
console.log('  ', up ? `OK ${JSON.stringify(up.info)}` : 'FAIL');

/* 回归：只有"自己拉起的实例"才要求第二次 ensure 不误判；
 * 平台上一次已经由别人（比如 DSH 里的插件实例）拉起时，external=true 才是正确答案。 */
if (status.external === false) {
  await api.ensure(true);
  const twice = api.status();
  console.log('— 二次 ensure（回归）—');
  console.log(`  external=${twice.external} pid=${twice.pid} phase=${twice.phase}`);
  if (twice.external !== false) {
    console.error('  ✘ 自己拉起的实例被误判成外部实例');
    process.exitCode = 1;
  }
} else {
  console.log('— 二次 ensure（跳过：本次复用外部实例）—');
}

/* 真跑一遍 4 个只读工具（对着活的平台） */
const { createTools } = await import('../lib/tools.js');
const tools = new Map(createTools({
  baseUrl: () => 'http://127.0.0.1:8777/',
  excludePaths: ['LearningHarness/'],
}).map((t) => [t.name, t]));
const run = async (name, args) => {
  const def = tools.get(name);
  const value = await def.execute(args, {});
  const rendered = String(value.render ?? '');
  console.log(`— ${name}(${JSON.stringify(args)}) ok=${value.ok} 输出 ${rendered.length} 字符 —`);
  console.log('  ' + rendered.split('\n').slice(0, 6).join('\n  '));
  return value;
};

await run('study_tree', { path: '' });
await run('study_search', { query: '注意力', limit: 3 });
await run('study_outline', { path: '规划/StudyHub-总体规划.md' });
await run('study_read', { path: '规划/StudyHub-总体规划.md', maxChars: 600 });

console.log('— shutdown —');
await api.shutdown();
await new Promise((r) => setTimeout(r, 600));
const after = await probePort(8777, 500);
// 自己拉起的：必须停干净；复用别人的：必须不为它做主（还在才是对的）
const shutdownOk = status.external === true ? Boolean(after) : !after;
console.log(`  停掉后再探: ${after ? '还在' : '已停止'}（${status.external ? '外部实例 —— 保持运行才是对的' : '本插件拉起 —— 应已停止'}）`);

fs.rmSync(home, { recursive: true, force: true });
process.exit(process.exitCode === 1 ? 1 : (status.phase === 'online' && up && shutdownOk ? 0 : 1));
