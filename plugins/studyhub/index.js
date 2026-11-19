/**
 * dsh-studyhub · 宿主半边
 *
 * 职责只有三件，刻意不做更多：
 *   1. 探活 / 拉起 / 停下本机的「agent 学习平台」（Python，127.0.0.1:8777）；
 *   2. 给浏览器半边提供一条只读状态路由（/studyhub/*），让它知道该 iframe 哪个地址；
 *   3. 记录能力探测结果与失败原因，DSH 升级后一眼能看出是哪一层断了。
 *
 * 兼容策略（DSH 经常破坏性更新）：
 *   - **不声明 inject**，只用 `ctx.get('webServer')` 这种可选取法。服务没了就是降级，不是加载失败。
 *   - 每个注册点独立 try/catch，把结果写进 diag，路由 /studyhub/status 原样吐出来。
 *   - 不 import 任何 `@deepseek-ai/*` 运行时代码（只在最外层 try 里读一次版本号，读不到就算了）。
 *   - 客户端半边拿不到状态路由时，会退回「固定地址 + 用浏览器打开」，面板不会白屏。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJsonBody, sendJson } from './lib/http.js';
import {
  createLog,
  probePort,
  scanPorts,
  startServer,
  stopServer,
  waitForPorts,
} from './lib/platform.js';
import { createTools } from './lib/tools.js';

export const name = 'studyhub';

const PLUGIN_VERSION = '0.1.0';

const DEFAULTS = {
  platformDir: 'C:\\StudyAI\\_webapp',
  python: 'python',
  port: 8777,
  span: 12,
  autoStart: true,
  extraArgs: ['--ide'],
  startTimeoutMs: 25000,
  logDir: '',
  /** 额外注册 4 个只读工具（study_tree / search / outline / read），供教学插件取材料 */
  enableTools: true,
  /** 搜索时跳过的路径前缀：这些是参考资料，不是讲义 */
  excludePaths: ['LearningHarness/'],
};

const asArray = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.trim().split(/\s+/);
  return [];
};

const normalizeConfig = (raw = {}) => {
  const port = Number.parseInt(raw.port ?? DEFAULTS.port, 10);
  const span = Number.parseInt(raw.span ?? DEFAULTS.span, 10);
  return {
    platformDir: String(raw.platformDir ?? DEFAULTS.platformDir),
    python: String(raw.python ?? DEFAULTS.python) || DEFAULTS.python,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULTS.port,
    span: Number.isInteger(span) && span > 0 && span <= 64 ? span : DEFAULTS.span,
    autoStart: raw.autoStart === undefined ? DEFAULTS.autoStart : Boolean(raw.autoStart),
    extraArgs: raw.extraArgs === undefined ? DEFAULTS.extraArgs.slice() : asArray(raw.extraArgs),
    startTimeoutMs: Number(raw.startTimeoutMs) > 0 ? Number(raw.startTimeoutMs) : DEFAULTS.startTimeoutMs,
    logDir: String(raw.logDir ?? DEFAULTS.logDir),
    enableTools: raw.enableTools === undefined ? DEFAULTS.enableTools : Boolean(raw.enableTools),
    excludePaths: raw.excludePaths === undefined ? DEFAULTS.excludePaths.slice() : asArray(raw.excludePaths),
  };
};

const dshHome = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

/** 尽力读一下 DSH 版本：读不到就是 null，不影响任何逻辑，只进诊断。
 *
 * 注意（2026-11-19 踩过）：`dsh --version` 读的是 npm 全局里那份**独立 CLI**，
 * 桌面 App 用的是 app.asar 里打包的那份，两者版本可以差好几个 rc。
 * 所以这里优先读 `DSH_INSTALL_DIR` —— 它由当前进程注入，指的一定是**正在跑的那份**。
 * Electron 的 fs 打过补丁，能直接读 asar 里的路径；纯 node 下会抛，回落即可。
 */
const detectDshVersion = () => {
  const candidates = [];
  if (process.env.DSH_INSTALL_DIR) candidates.push(path.join(process.env.DSH_INSTALL_DIR, 'package.json'));
  // Electron 主进程里有 process.resourcesPath；它的 fs 打过 asar 补丁，能直接读包内路径
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'));
  }
  try {
    const require = createRequire(import.meta.url);
    candidates.push(require.resolve('@deepseek-ai/dsh/package.json'));
  } catch {
    /* 解析不到就算了 */
  }
  for (const file of candidates) {
    try {
      const version = JSON.parse(fs.readFileSync(file, 'utf8')).version;
      if (version) return version;
    } catch {
      /* 下一个 */
    }
  }
  return null;
};

/** 当前 profile 名：优先环境变量，其次从进程参数里的 `profiles\<name>` 摸。 */
const detectProfile = () => {
  if (process.env.DSH_PROFILE) return process.env.DSH_PROFILE;
  for (const arg of process.argv) {
    const hit = /[\\/]profiles[\\/]([^\\/]+)/.exec(String(arg));
    if (hit) return hit[1];
  }
  return null;
};

export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config);
  const log = createLog(
    path.join(cfg.logDir || path.join(dshHome(), 'studyhub', 'logs'), 'server.log'),
  );

  const diag = {
    plugin: 'dsh-studyhub',
    version: PLUGIN_VERSION,
    loadedAt: new Date().toISOString(),
    dshVersion: detectDshVersion(),
    profile: detectProfile(),
    node: process.version,
    platform: process.platform,
    capabilities: {},
    registrations: {},
    errors: [],
    clientReport: null,
  };

  const note = (where, err) => {
    const text = `${where}: ${err?.message || String(err)}`;
    diag.errors.push(text);
    log.push(`[diag] ${text}`);
  };

  /** 运行状态。phase: idle | starting | online | offline | error */
  const state = {
    phase: 'idle',
    url: null,
    port: null,
    pid: null,
    external: false,
    error: null,
    startedAt: null,
  };
  let child = null;
  let starting = null;

  const setOnline = (hit, external) => {
    state.phase = 'online';
    state.url = hit.url;
    state.port = hit.port;
    state.external = external;
    state.pid = external ? null : (child?.pid ?? null);
    state.error = null;
    state.startedAt = state.startedAt ?? new Date().toISOString();
    log.push(`[state] online ${hit.url} (${external ? '复用已有实例' : `pid ${state.pid}`})`);
  };

  const setFailure = (message) => {
    state.phase = 'error';
    state.error = message;
    state.url = null;
    log.push(`[state] error: ${message}`);
  };

  const serverEntry = () => path.join(cfg.platformDir, 'server.py');

  const reset = () => {
    child = null;
    state.pid = null;
    state.port = null;
    state.url = null;
    state.external = false;
    state.error = null;
  };

  /**
   * 保证服务在线。allowSpawn=false 时只探不拉（用于开机预热失败后的只读查询）。
   * 永远不 reject：失败会落到 state.phase='error'。
   */
  const ensure = (allowSpawn) => {
    if (starting) return starting;
    starting = (async () => {
      try {
        // 记住上一次的在线状态，但每次都要复验 —— 否则服务被外部杀掉后，
        // 状态会一直"谎报在跑"（首次联调里就撞到过：8777 已经空了，status 还写 online）。
        if (state.phase === 'online' && state.port) {
          const alive = await probePort(state.port, 600);
          if (alive) {
            // 仍然在线：保持 external 标记不变（自己拉起的不许降级成外部实例，
            // 否则 shutdown 就"不敢"停它 —— 这个 bug 也真实发生过）
            if (!state.external && child && child.exitCode === null) state.pid = child.pid ?? null;
            return;
          }
          log.push(`[state] ${state.url} 已不在线`);
          reset();
          state.phase = 'offline';
        }

        const existing = await scanPorts(cfg.port, cfg.span);
        if (existing) {
          setOnline(existing, true);
          return;
        }
        if (!allowSpawn) {
          // 走到这里说明确实没探到：状态必须诚实（宁可显示"未连接"）
          state.phase = 'offline';
          state.error = null;
          return;
        }
        if (!fs.existsSync(serverEntry())) {
          setFailure(`platformDir 里找不到 server.py：${serverEntry()}`);
          return;
        }
        state.phase = 'starting';
        state.error = null;
        const spawnArgs = [...cfg.extraArgs, '--no-browser'];
        log.push(`[state] starting ${cfg.python} server.py ${spawnArgs.join(' ')} @ ${cfg.platformDir}`);
        child = startServer({
          python: cfg.python,
          platformDir: cfg.platformDir,
          // --no-browser：我们自己嵌入面板，别让它弹一个新窗口
          args: spawnArgs,
          env: {
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            PYTHONDONTWRITEBYTECODE: '1',
          },
          onLine: (line) => log.push(line),
        });
        state.pid = child.pid ?? null;
        const dead = () => child && child.exitCode !== null;
        const hit = await waitForPorts(cfg.port, cfg.span, cfg.startTimeoutMs, dead);
        if (hit) {
          setOnline(hit, false);
          return;
        }
        const tail = log.tail(6).join(' | ');
        setFailure(
          dead()
            ? `服务进程已退出（详见日志）。${tail}`
            : `${Math.round(cfg.startTimeoutMs / 1000)} 秒内没等到 ${cfg.port} 上线。${tail}`,
        );
      } catch (err) {
        setFailure(`拉起失败：${err?.message || err}`);
      } finally {
        starting = null;
      }
    })();
    return starting;
  };

  const shutdown = async () => {
    if (state.external) {
      log.push('[state] 外部实例，不停它');
      state.phase = 'offline';
      state.url = null;
      return;
    }
    if (child) {
      log.push('[state] stopping own child');
      await stopServer(child);
    }
    reset();
    state.phase = 'offline';
  };

  const statusPayload = () => ({
    ok: true,
    plugin: diag.plugin,
    version: diag.version,
    phase: state.phase,
    online: state.phase === 'online',
    url: state.url,
    port: state.port,
    pid: state.pid,
    external: state.external,
    startedAt: state.startedAt,
    error: state.error,
    config: {
      platformDir: cfg.platformDir,
      python: cfg.python,
      port: cfg.port,
      autoStart: cfg.autoStart,
      extraArgs: cfg.extraArgs,
      enableTools: cfg.enableTools,
      excludePaths: cfg.excludePaths,
      serverEntry: serverEntry(),
      serverEntryExists: fs.existsSync(serverEntry()),
    },
    dsh: {
      version: diag.dshVersion,
      profile: diag.profile,
      node: diag.node,
      platform: diag.platform,
      capabilities: diag.capabilities,
      registrations: diag.registrations,
      errors: diag.errors.slice(-10),
    },
    clientReport: diag.clientReport,
    logTail: log.tail(25),
  });

  /* ───────────── 状态/控制路由（唯一的宿主对外面） ───────────── */

  const handler = async (req, res) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      pathname = String(req.url ?? '/');
    }
    const sub = pathname.replace(/^\/studyhub/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      if (sub === '/status' && method === 'GET') {
        // 只读：不主动拉起，避免"打开面板就偷偷起进程"
        await ensure(false);
        return sendJson(res, 200, statusPayload());
      }
      if (sub === '/start' && method === 'POST') {
        await ensure(true);
        return sendJson(res, 200, statusPayload());
      }
      if (sub === '/restart' && method === 'POST') {
        await shutdown();
        await ensure(true);
        return sendJson(res, 200, statusPayload());
      }
      if (sub === '/stop' && method === 'POST') {
        await shutdown();
        return sendJson(res, 200, statusPayload());
      }
      if (sub === '/log' && method === 'GET') {
        return sendJson(res, 200, { ok: true, file: log.file, lines: log.all() });
      }
      /**
       * 只读诊断：把 DSH 现有的 agent preset 连同它们的真实声明读出来。
       * 写「学习模式」时要照着现有模式的 `plugins` 行照抄，不能凭空编。
       */
      if (sub === '/presets' && method === 'GET') {
        const presets = (() => {
          try { return ctx.get?.('agentPresets') ?? null; } catch { return null; }
        })();
        if (!presets) return sendJson(res, 200, { ok: false, error: '宿主没有 agentPresets 服务' });
        const list = await presets.list();
        const docs = {};
        for (const row of list ?? []) {
          try {
            docs[row.id] = await presets.readDocument(row.id);
          } catch (err) {
            docs[row.id] = { error: err?.message || String(err) };
          }
        }
        return sendJson(res, 200, { ok: true, list, docs });
      }
      if (sub === '/selfcheck' && method === 'POST') {
        const body = await readJsonBody(req);
        diag.clientReport = { ...body, receivedAt: new Date().toISOString() };
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { ok: false, error: `unknown studyhub route: ${method} ${sub}` });
    } catch (err) {
      note('route', err);
      return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
    }
  };

  /* ───────────── 注册（每一步都独立兜底） ───────────── */

  let dispose = null;
  /** 补注册用的定时器，卸载时要清掉 */
  const timers = [];

  /**
   * 取 webServer —— 只用 `ctx.get()`，**绝不**写 `ctx.webServer`。
   * cordis 里没声明 inject 就访问服务属性会直接抛 "cannot get property ... without inject"，
   * 而声明 inject 又会让插件在服务缺席时整个不加载（换个方向变脆）。
   * 折中：可选取 + 服务晚到就重试（冷启动时插件可能先于 webserver 行装配）。
   */
  const findWebServer = () => {
    try {
      const web = typeof ctx.get === 'function' ? ctx.get('webServer') : null;
      return web && typeof web.register === 'function' ? web : null;
    } catch {
      return null;
    }
  };

  const tryRegisterRoutes = () => {
    if (dispose) return true;
    const web = findWebServer();
    diag.capabilities.webServer = Boolean(web);
    if (!web) return false;
    try {
      dispose = web.register({ kind: 'prefix', path: '/studyhub', handler });
      diag.registrations.routes = true;
      log.push('[diag] /studyhub/* 已注册');
      return true;
    } catch (err) {
      diag.registrations.routes = false;
      // "duplicate prefix route" 说明上一份实例还没卸载干净，别再重试了
      note('routes', err);
      return true;
    }
  };

  if (!tryRegisterRoutes()) {
    note('routes', 'webServer 服务还没就绪（面板会先退化成固定地址，就绪后自动补注册）');
    let tries = 0;
    const retry = setInterval(() => {
      tries += 1;
      if (tryRegisterRoutes() || tries >= 60) {
        clearInterval(retry);
        if (diag.registrations.routes) log.push('[diag] webServer 就绪，路由已补注册');
      }
    }, 500);
    retry.unref?.();
    timers.push(retry);
  }

  /* ───────────── 只读工具（给教学插件取材料） ───────────── */

  const toolDisposers = [];
  const tryRegisterTools = () => {
    if (!cfg.enableTools || toolDisposers.length) return true;
    const tools = (() => {
      try {
        const svc = typeof ctx.get === 'function' ? ctx.get('tools') : null;
        return svc && typeof svc.register === 'function' ? svc : null;
      } catch {
        return null;
      }
    })();
    diag.capabilities.tools = Boolean(tools);
    if (!tools) return false;
    let registered = 0;
    for (const definition of createTools({
      baseUrl: () => state.url,
      log: (line) => log.push(line),
      excludePaths: cfg.excludePaths,
    })) {
      try {
        const disposer = tools.register(definition);
        if (typeof disposer === 'function') toolDisposers.push(disposer);
        registered += 1;
      } catch (err) {
        note(`tool:${definition.name}`, err);
      }
    }
    diag.registrations.tools = registered;
    if (registered) log.push(`[diag] 已注册 ${registered} 个只读工具`);
    return true;
  };

  if (!tryRegisterTools()) {
    note('tools', 'tools 服务还没就绪（只读工具稍后补注册）');
    let tries = 0;
    const retry = setInterval(() => {
      tries += 1;
      if (tryRegisterTools() || tries >= 60) clearInterval(retry);
    }, 500);
    retry.unref?.();
    timers.push(retry);
  }

  /* ───────────── agent preset「学习模式」 ─────────────
   *
   * preset 不是"人设提示词"，它是**这个会话的插件组合**。所以：
   *   - 只挑内核必需的行（persona / 只读文件 / 提问 / 联网 / 压缩）
   *   - 不挂 shell、子代理、workflow、office、插件管理这些"干活"工具
   *   - study_* / learn_* 不用写进来：它们是 profile 级插件，任何 preset 下都在
   *
   * 依据（实测）：本机 0.2.2-rc.5 的 standard 127 行 / minimal 4 行，
   * persona 支持 complete:true（prefix 即完整系统提示）。
   */
  const STUDY_PERSONA = [
    '你是学习助手：教师的严谨 + 陪读的耐心，运行在「学习台」环境里。',
    '',
    '这里有两类工具，分工不同：',
    '- study_*：读用户自己的讲义。study_search 找章节、study_outline 看结构、study_read 取正文、study_tree 看目录。',
    '- learn_*：教学法。探底（probe）→ 依赖图（plan）→ 一轮一个推理步（explain/quiz）→ 判分与记录。状态会跨轮次延续。',
    '',
    '规则：',
    '1. 用户要「真正学会」时走 learn_* 的节奏：先测量理解边界，再画依赖图，然后一轮只推进一个推理步。不要一口气讲完。',
    '2. 讲解必须引材料：先 study_search / study_outline 定位，再 study_read 取原文；引用时给出章节路径。',
    '3. 检查不过就回到这一步重讲，绝不往下走。不谄媚、不铺垫、不夸"好问题"。',
    '4. 答错时先定位断点（"你把 A 当成 B 了"），不要直接把正确答案端出来。',
    '5. 用户只是问事实（"X 是什么"），就直接答，不要启动教学流程。',
    '6. 不确定就明说，然后去查；不要编。',
  ].join('\n');

  const STUDY_PRESET = {
    id: 'study',
    name: '学习模式',
    description: '先测量理解边界，再按依赖图一轮推进一个推理步；讲义可直接检索引用，出题与判分带承诺答案键。',
    order: 40,
    plugins: [
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: { prefix: STUDY_PERSONA, complete: true, includeRuntimeContext: false },
      },
      {
        id: 'tool-fs',
        name: '@deepseek-ai/dsh-tool-fs',
        // 只读：讲义和练习题要看，改/写留给平台自己的练习区
        config: { read: true, write: false, edit: false, readImage: true },
      },
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      {
        id: 'tool-web',
        name: '@deepseek-ai/dsh-tool-web',
        config: { fetch: true, searchTimeoutMs: 60000 },
      },
      {
        id: 'compaction',
        name: 'cordis:group',
        group: true,
        isolate: { compaction: true },
        config: [
          { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
          { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
        ],
      },
    ],
  };

  let presetDispose = null;
  const tryRegisterPreset = () => {
    if (presetDispose || diag.registrations.preset === 'pending') return Boolean(presetDispose);
    const presets = (() => {
      try { return ctx.get?.('agentPresets') ?? null; } catch { return null; }
    })();
    diag.capabilities.agentPresets = Boolean(presets && typeof presets.register === 'function');
    if (!diag.capabilities.agentPresets) return false;
    diag.registrations.preset = 'pending';
    Promise.resolve(presets.register(STUDY_PRESET))
      .then((off) => {
        presetDispose = typeof off === 'function' ? off : null;
        diag.registrations.preset = 'study';
        log.push('[diag] 已注册 agent preset「学习模式」');
      })
      .catch((err) => {
        diag.registrations.preset = 'failed';
        note('preset', err);
      });
    return true;
  };

  if (!tryRegisterPreset()) {
    // agentPresets 也可能是晚到的服务，跟 webServer/tools 一样补注册
    let tries = 0;
    const retry = setInterval(() => {
      tries += 1;
      if (tryRegisterPreset() || tries >= 60) clearInterval(retry);
    }, 500);
    retry.unref?.();
    timers.push(retry);
  }

  /**
   * 生命周期：卸载/重载时只结束我们自己拉起的进程。
   * 用 ctx.effect（cordis 的正规做法）；没有 effect 就退化成 no-op，不抛。
   */
  let timer = null;
  try {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        if (timer) clearTimeout(timer);
        for (const pending of timers) clearInterval(pending);
        for (const off of toolDisposers) {
          try {
            off();
          } catch {
            /* 已随上下文销毁 */
          }
        }
        try {
          presetDispose?.();
        } catch {
          /* preset 已随上下文销毁 */
        }
        try {
          dispose?.();
        } catch {
          /* 路由已随上下文销毁 */
        }
        void shutdown();
      }, 'studyhub.lifecycle');
      diag.registrations.lifecycle = true;
    }
  } catch (err) {
    diag.registrations.lifecycle = false;
    note('lifecycle', err);
  }

  // 插件加载时预热：延迟 1.2s，别跟启动抢时间片
  if (cfg.autoStart) {
    timer = setTimeout(() => {
      void ensure(true);
    }, 1200);
    timer.unref?.();
  }

  log.push(`[diag] loaded (dsh=${diag.dshVersion ?? 'unknown'}, profile=${diag.profile ?? '?'}, webServer=${diag.capabilities.webServer})`);

  // 给测试/调试用：不依赖 ctx 也能拿到内部状态
  return { status: statusPayload, ensure, shutdown, dispose };
}
