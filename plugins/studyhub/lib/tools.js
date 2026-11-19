/**
 * 学习台的「读」工具：把 /api/* 只读接口包成模型能直接用的 4 个工具。
 *
 * 存在意义：LearnHarness 那套教学插件（learn_*）本身不带材料——它只负责
 * 「测 → 规划 → 教 → 练」，材料得由外部给。这四个工具就是那份材料通道：
 *
 *   study_tree     看目录（第几章、有哪些文件）
 *   study_search   全文搜（"transformer 在哪一章"）
 *   study_outline  只取标题结构（规划一节课时最省 token）
 *   study_read     读正文（带截断，避免把上下文打穿）
 *
 * 全部只读，不写任何文件。
 */
import { getJson, postJson } from './http.js';
import { defineTool } from './tool-schema.js';

const TEXT_OUTPUT = {
  schema: { type: 'object', properties: { ok: { type: 'boolean', required: true } }, additionalProperties: true },
  render: (args, value) => [{ type: 'text', text: String(value.render ?? JSON.stringify(value, null, 2)) }],
};

const clip = (text, limit) => {
  const value = String(text ?? '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n…[已截断，原文 ${value.length} 字符。要结构看 study_outline，要更多正文加大 maxChars]`;
};

const fmtSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * @param {object} options
 * @param {() => string|null} options.baseUrl 当前平台地址（可能尚未在线）
 * @param {(line: string) => void} [options.log]
 * @param {string[]} [options.excludePaths] 搜索时跳过的路径前缀
 */
export const createTools = ({ baseUrl, log, excludePaths = [] }) => {
  const call = async (path) => {
    const base = baseUrl();
    if (!base) return { ok: false, error: '学习平台当前不在线：先让宿主把服务起来（面板里的「启动服务」，或直接 python server.py）。' };
    const res = await getJson(`${base.replace(/\/$/, '')}${path}`, 8000);
    if (!res.ok) return { ok: false, error: `平台接口失败：${res.error ?? `HTTP ${res.status}`}` };
    return { ok: true, data: res.json };
  };

  const q = (params) => Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

  const tools = [];

  /* ── study_tree ─────────────────────────────────────────── */
  tools.push(defineTool({
    name: 'study_tree',
    description: '列出「学习台」里某个目录的子目录与文件（默认资料根）。不递归。用于确认第几章、有哪些讲义/代码。',
    parameters: {
      path: { type: 'string', description: '资料根相对路径，空字符串或省略 = 根目录，例如 "01-AI-Agent全栈课程"' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const rel = String(args?.path ?? '').trim();
      const res = await call(`/api/tree?${q({ path: rel })}`);
      if (!res.ok) return { ok: false, render: res.error };
      const d = res.data;
      const dirs = (d.dirs ?? []).map((x) => `  ${x.name}/`).join('\n');
      const files = (d.files ?? []).map((x) => `  ${x.name}  (${fmtSize(x.size)}, ${x.kind ?? '?'})`).join('\n');
      return {
        ok: true,
        render: [
          `目录：${d.path || '（根）'}  子目录 ${(d.dirs ?? []).length} 个，文件 ${(d.files ?? []).length} 个`,
          dirs ? `\n[子目录]\n${dirs}` : '',
          files ? `\n[文件]\n${files}` : '',
          '\n下一步：study_outline <文件> 看结构，study_read <文件> 读正文，study_search <关键词> 全文搜。',
        ].filter(Boolean).join('\n'),
      };
    },
  }));

  /* ── study_search ───────────────────────────────────────── */
  tools.push(defineTool({
    name: 'study_search',
    description: '在「学习台」全库做全文搜索（含 UTF-8/GBK 回退）。回答"某主题在哪一章"、给教学找材料时先用它。',
    parameters: {
      query: { type: 'string', required: true, description: '关键词，至少 2 个字符' },
      limit: { type: 'number', description: '最多返回多少个文件（默认 12）' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const query = String(args?.query ?? '').trim();
      if (query.length < 2) return { ok: false, render: '关键词至少 2 个字符。' };
      const limit = Number(args?.limit) > 0 ? Math.min(Number(args.limit), 50) : 12;
      // 服务端按文件数截断，这里多要一点以便过滤掉排除项
      const res = await call(`/api/search?${q({ q: query, limit: limit + excludePaths.length })}`);
      if (!res.ok) return { ok: false, render: res.error };
      const all = res.data.results ?? [];
      const kept = all.filter((hit) => !excludePaths.some((prefix) => String(hit.path ?? '').startsWith(prefix))).slice(0, limit);
      if (!kept.length) {
        return { ok: true, render: `没搜到「${query}」。换更短的关键词，或用 study_tree 看目录结构。` };
      }
      const body = kept.map((hit, i) => {
        const hits = (hit.hits ?? []).filter((x) => x.match).slice(0, 2);
        const lines = hits.map((x) => `     L${x.line}: ${String(x.text ?? '').trim().slice(0, 140)}`).join('\n');
        return `${i + 1}. ${hit.path}  (${hit.kind ?? '?'}，命中 ${hit.count ?? hits.length} 处)\n${lines}`;
      }).join('\n');
      return { ok: true, render: `「${query}」命中 ${kept.length} 个文件：\n${body}\n\n下一步：study_read 读其中一个，study_outline 先看结构更省。` };
    },
  }));

  /* ── study_outline ──────────────────────────────────────── */
  tools.push(defineTool({
    name: 'study_outline',
    description: '只取一份 Markdown/文本文件的标题结构（#/##/###），不返回正文。规划"这一章要教什么"时最省 token。',
    parameters: {
      path: { type: 'string', required: true, description: '资料根相对路径，例如 "01-AI-Agent全栈课程/chapter_03_xxx/readme.md"' },
      depth: { type: 'number', description: '取到几级标题，默认 3' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const rel = String(args?.path ?? '').trim();
      if (!rel) return { ok: false, render: '需要 path。' };
      const depth = Math.min(Math.max(Number(args?.depth) || 3, 1), 6);
      const res = await call(`/api/file?${q({ path: rel })}`);
      if (!res.ok) return { ok: false, render: res.error };
      const d = res.data;
      if (d.content == null) return { ok: false, render: `${rel} 读不出文本：${d.reason ?? '可能是二进制或过大'}。` };
      const headings = [];
      for (const line of String(d.content).split(/\r?\n/)) {
        const hit = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (hit && hit[1].length <= depth) headings.push(`${'  '.repeat(hit[1].length - 1)}- ${hit[2]}`);
      }
      if (!headings.length) {
        return { ok: true, render: `${rel} 没有 Markdown 标题（kind=${d.kind ?? '?'}，${fmtSize(d.size)}）。直接用 study_read 读正文。` };
      }
      return {
        ok: true,
        render: `${rel}（${fmtSize(d.size)}）共 ${headings.length} 个标题：\n${headings.join('\n')}\n\n下一步：挑一节用 study_read 读正文，再交给教学流程。`,
      };
    },
  }));

  /* ── study_read ─────────────────────────────────────────── */
  tools.push(defineTool({
    name: 'study_read',
    description: '读「学习台」里一份文件的文本正文。默认截断到 4000 字符以免打穿上下文；需要更多就加大 maxChars。',
    parameters: {
      path: { type: 'string', required: true, description: '资料根相对路径' },
      maxChars: { type: 'number', description: '最多返回多少字符，默认 4000，上限 20000' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const rel = String(args?.path ?? '').trim();
      if (!rel) return { ok: false, render: '需要 path。' };
      const maxChars = Math.min(Math.max(Number(args?.maxChars) || 4000, 500), 20000);
      const res = await call(`/api/file?${q({ path: rel })}`);
      if (!res.ok) return { ok: false, render: res.error };
      const d = res.data;
      if (d.content == null) return { ok: false, render: `${rel} 没有可读文本：${d.reason ?? '二进制或过大'}。` };
      const head = `# ${d.name}\npath: ${d.path}\nkind: ${d.kind ?? '?'} · ${fmtSize(d.size)} · ${d.encoding ?? 'utf-8'}\n---`;
      log?.(`[tool] study_read ${rel} (${String(d.content).length} 字符)`);
      return { ok: true, render: `${head}\n${clip(d.content, maxChars)}` };
    },
  }));

  /* ───────────────── 语言包（写操作的入口） ───────────────── */

  const post = async (path, body) => {
    const base = baseUrl();
    if (!base) return { ok: false, error: '学习平台当前不在线：先让宿主把服务起来。' };
    const res = await postJson(`${base.replace(/\/$/, '')}${path}`, body, 20000);
    if (!res.ok) {
      const message = (res.json && res.json.error) || res.error || `HTTP ${res.status}`;
      return { ok: false, error: message };
    }
    return { ok: true, data: res.json };
  };

  const splitList = (value) => {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(/[,;，；\s]+/).map((v) => v.trim()).filter(Boolean);
    return [];
  };

  const renderLangs = (data) => {
    const list = (data && data.languages) || [];
    if (!list.length) return '没有语言包。';
    const lines = list.map((item) => {
      const state = item.available
        ? '可用'
        : `缺 ${(item.missing || []).join('/')}`;
      return `- ${item.id}（${item.name}）${(item.ext || []).join(' ')} · ${state}${item.twoStage ? ' · 两段式' : ''}`;
    });
    const errs = (data && data.languageErrors) || [];
    return [
      `共 ${list.length} 个语言包：`,
      ...lines,
      errs.length ? `\n有 ${errs.length} 个插件有问题：\n${errs.map((e) => `  ! ${e}`).join('\n')}` : '',
      data && data.pluginsDir ? `\n插件目录：${data.pluginsDir}` : '',
    ].filter(Boolean).join('\n');
  };

  tools.push(defineTool({
    name: 'study_lang_list',
    description: '列出「学习台」编辑器已装的语言包：支持哪些扩展名、依赖装没装、缺什么。要加语言前先看这个。',
    parameters: {},
    output: TEXT_OUTPUT,
    async execute() {
      const res = await call('/api/ide/languages');
      if (!res.ok) return { ok: false, render: res.error };
      return { ok: true, render: renderLangs(res.data) };
    },
  }));

  tools.push(defineTool({
    name: 'study_lang_install',
    description: [
      '给「学习台」编辑器装一个语言包（只接受声明，不执行任何脚本）。',
      '必填 id 与 cmd；两段式语言（C/C++/Rust…）再给 buildCmd/buildArgs。',
      '装完会返回最新列表，如果显示"缺 xxx"就说明这台机器缺那个编译器。',
      '示例：id=rust, ext=.rs, cmd={exe}, buildCmd=rustc, buildArgs="-O -o {exe} {file}", requires=rustc',
    ].join(' '),
    parameters: {
      id: { type: 'string', required: true, description: '小写 slug，如 rust / go / java' },
      name: { type: 'string', description: '显示名，默认同 id' },
      ext: { type: 'string', description: '扩展名，逗号分隔，如 ".rs" 或 ".go"' },
      cmd: { type: 'string', required: true, description: '运行命令，如 node、{python}、{exe}' },
      args: { type: 'string', description: '运行参数，空格分隔，如 "{file}"' },
      buildCmd: { type: 'string', description: '编译命令（两段式语言才需要）' },
      buildArgs: { type: 'string', description: '编译参数，如 "-O2 -o {exe} {file}"' },
      requires: { type: 'string', description: '依赖命令，逗号分隔；默认取运行/编译命令' },
      timeout: { type: 'number', description: '秒，默认 10' },
      editor: { type: 'string', description: 'Monaco 语言 id，默认同 id' },
      json: { type: 'string', description: '想直接给整份 plugin.json？填这里，其他字段忽略' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      let payload;
      if (args && args.json) {
        try {
          payload = JSON.parse(String(args.json));
        } catch (err) {
          return { ok: false, render: `json 不是合法 JSON：${err?.message || err}` };
        }
      } else {
        payload = {
          id: args?.id,
          name: args?.name || args?.id,
          ext: splitList(args?.ext),
          run: { cmd: args?.cmd, args: splitList(args?.args) },
        };
        if (args?.buildCmd) {
          payload.build = { cmd: args.buildCmd, args: splitList(args?.buildArgs) };
        }
        const requires = splitList(args?.requires);
        if (requires.length) payload.requires = requires;
        if (args?.timeout) payload.timeout = Number(args.timeout);
        if (args?.editor) payload.editor = args.editor;
      }
      const res = await post('/api/ide/languages', payload);
      if (!res.ok) return { ok: false, render: `装语言包失败：${res.error}` };
      log?.(`[tool] study_lang_install ${res.data?.installed || ''}`);
      return {
        ok: true,
        render: `已安装语言包 ${res.data?.installed}（写到 ${res.data?.pluginsDir}）\n${renderLangs(res.data)}`,
      };
    },
  }));

  tools.push(defineTool({
    name: 'study_lang_remove',
    description: '卸载一个语言包（删掉 plugins/<id> 目录，不可恢复）。内置的 python 删了也会回落到兜底声明。',
    parameters: {
      id: { type: 'string', required: true, description: '语言包 id' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const res = await post('/api/ide/languages/remove', { id: args?.id });
      if (!res.ok) return { ok: false, render: `卸载失败：${res.error}` };
      return { ok: true, render: `已卸载 ${res.data?.removed}\n${renderLangs(res.data)}` };
    },
  }));

  /* ───────────────── Python 私有库（不碰系统环境） ───────────────── */

  const renderLibs = (data) => {
    const list = (data && data.packages) || [];
    const kb = Math.round(((data && data.bytes) || 0) / 1024);
    const head = `私有库目录：${data?.dir || '?'}（${list.length} 个包，${kb} KB）`;
    if (!list.length) return `${head}\n目录是空的。系统解释器里已装的包可以直接 import，不用放进来。`;
    return [head, ...list.map((p) => `- ${p.name} ${p.version}`)].join('\n');
  };

  tools.push(defineTool({
    name: 'study_py_list',
    description: '列出「学习台」私有 Python 库目录里装了什么、占多少空间。系统解释器里已有的包不在这个列表里（那是正常的，能直接 import）。',
    parameters: {},
    output: TEXT_OUTPUT,
    async execute() {
      const res = await call('/api/ide/pylibs');
      if (!res.ok) return { ok: false, render: res.error };
      return { ok: true, render: renderLibs(res.data) };
    },
  }));

  tools.push(defineTool({
    name: 'study_py_install',
    description: [
      '往「学习台」的私有库目录装 Python 包（pip --target），**不碰系统解释器**。',
      '会先探测系统里有没有：已有的一律跳过，只有缺的才装。',
      '只有用户明确要装某个包时才调用；不确定装什么先 study_py_list 或问用户。',
    ].join(' '),
    parameters: {
      packages: { type: 'string', required: true, description: '包名，逗号或空格分隔，如 "openai python-dotenv"' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const text = String(args?.packages ?? '').trim();
      if (!text) return { ok: false, render: '需要 packages。' };
      const res = await post('/api/ide/pylibs', { packages: text });
      if (!res.ok) return { ok: false, render: `安装失败：${res.error}` };
      const d = res.data || {};
      const lines = [];
      if ((d.skipped || []).length) lines.push(`已存在、跳过：${d.skipped.join(', ')}`);
      if ((d.installed || []).length) lines.push(`新装：${d.installed.join(', ')}（${d.seconds ?? '?'}s）`);
      const tail = (d.log || '').split('\n').slice(-6).join('\n');
      log?.(`[tool] study_py_install ${text}`);
      return { ok: true, render: `${lines.join('\n') || '完成'}\n${renderLibs(d)}\n--- pip 尾部 ---\n${tail}` };
    },
  }));

  tools.push(defineTool({
    name: 'study_py_clear',
    description: '清空「学习台」的私有 Python 库目录（不影响系统解释器已装的包）。删错了重装即可。',
    parameters: {},
    output: TEXT_OUTPUT,
    async execute() {
      const res = await post('/api/ide/pylibs/clear', {});
      if (!res.ok) return { ok: false, render: `清空失败：${res.error}` };
      return { ok: true, render: `已删除 ${res.data?.removed ?? 0} 项\n${renderLibs(res.data)}` };
    },
  }));

  return tools;
};
