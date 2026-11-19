/**
 * dsh-studyhub · 浏览器半边（手写 lazy-CJS，无构建步骤）
 *
 * 加载契约（0.2.2-rc.1 实测）：
 *   window.__ModuleLoader__.load({ id, factory: (require) => ({ inject, apply }) })
 *   React 由宿主提供：require('react')
 *
 * 做两件事：
 *   - 左栏一个「学习台」图标（sidebar.panellist）
 *   - 主面板里用 iframe 嵌本机学习平台（main）
 *
 * 兼容策略：每个注册点独立 try/catch；`main` 注册不上就退到右栏页签；
 * 状态路由拿不到就退到「固定地址 + 用浏览器打开」。任何一种失败都不会白屏。
 */
window.__ModuleLoader__.load({
  id: 'dsh-studyhub',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const h = React.createElement;

    const PLUGIN_ID = 'studyhub';
    const STATUS_URL = '/studyhub/status';
    const START_URL = '/studyhub/start';
    const RESTART_URL = '/studyhub/restart';
    const SELFCHECK_URL = '/studyhub/selfcheck';
    /** 宿主路由不可达时的兜底地址（学习平台自己也是普通网页，能单独开） */
    const FALLBACK_URL = 'http://127.0.0.1:8777/';
    const POLL_MS = 5000;

    const COLOR = {
      line: 'rgba(127,127,127,.28)',
      soft: 'rgba(127,127,127,.10)',
      muted: 'rgba(127,127,127,.9)',
      ok: '#2f9e44',
      bad: '#e03131',
      warn: '#f08c00',
    };

    const diag = { ok: [], errors: [], host: null };
    let lastReport = 0;
    /** apply() 时的 client ctx，组件里要用它拿 sessions / conversation */
    let hostCtx = null;

    const report = (extra) => {
      try {
        if (diag.host !== true) return;
        fetch(SELFCHECK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...diag, ...extra, href: location.href, at: new Date().toISOString() }),
        }).catch(() => {});
      } catch {
        /* 自检失败不影响功能 */
      }
    };

    /** 宿主路由只在 http(s) 页面下用相对路径；Electron 的 file:// 下必然失败。 */
    const hostRoutesUsable = () => typeof location !== 'undefined' && /^https?:$/.test(location.protocol);

    const fetchJson = async (url, init) => {
      const res = await fetch(url, { cache: 'no-store', ...(init ?? {}) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };

    /** 读宿主状态；不可用就返回 null（不抛）。 */
    const readStatus = async () => {
      if (!hostRoutesUsable()) {
        diag.host = false;
        return null;
      }
      try {
        const value = await fetchJson(STATUS_URL);
        diag.host = true;
        return value;
      } catch (err) {
        diag.host = false;
        diag.errors.push(`status: ${err?.message || err}`);
        return null;
      }
    };

    const themeHint = () => {
      try {
        const root = document.documentElement;
        const value = root?.dataset?.theme || root?.dataset?.colorScheme || document.body?.dataset?.theme || '';
        return /dark|light/i.test(String(value)) ? String(value).toLowerCase() : '';
      } catch {
        return '';
      }
    };

    /** 给学习平台的地址加一点嵌入提示（它现在会忽略不认识的参数，以后可以据此隐藏自己的顶栏）。 */
    const decorate = (url) => {
      if (!url) return url;
      const parts = ['embed=1'];
      const theme = themeHint();
      if (theme) parts.push(`theme=${theme}`);
      return `${url}${url.includes('?') ? '&' : '?'}${parts.join('&')}`;
    };

    const BookIcon = ({ size = 18 }) => h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z' }),
      h('path', { d: 'M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z' }),
      h('path', { d: 'M9 7.5h6' }),
    );

    const SidebarMark = ({ size = 18 }) => h(
      'span',
      {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          color: 'currentColor',
        },
      },
      h(BookIcon, { size }),
    );

    const pill = (text, tone) => h(
      'span',
      {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 11,
          lineHeight: '18px',
          color: tone ?? 'inherit',
          border: `1px solid ${COLOR.line}`,
          background: COLOR.soft,
          whiteSpace: 'nowrap',
        },
      },
      h('span', {
        style: {
          width: 6,
          height: 6,
          borderRadius: 999,
          background: tone ?? COLOR.muted,
          display: 'inline-block',
        },
      }),
      text,
    );

    const button = (label, onClick, options = {}) => h(
      'button',
      {
        type: 'button',
        onClick,
        disabled: options.disabled === true,
        title: options.title ?? label,
        style: {
          padding: '4px 10px',
          fontSize: 12,
          borderRadius: 7,
          border: `1px solid ${COLOR.line}`,
          background: 'transparent',
          color: 'inherit',
          cursor: options.disabled ? 'not-allowed' : 'pointer',
          opacity: options.disabled ? 0.55 : 1,
          whiteSpace: 'nowrap',
        },
      },
      label,
    );

    const phaseOf = (status) => {
      if (!status) return 'offline';
      if (status.online) return 'online';
      if (status.phase === 'starting') return 'starting';
      if (status.phase === 'error') return 'error';
      return 'offline';
    };

    const phaseText = (phase) => ({
      online: '已连接',
      starting: '启动中',
      error: '需要处理',
      offline: '未连接',
    }[phase] ?? phase);

    function StudyHubPanel(props) {
      const [status, setStatus] = React.useState(null);
      const [hostOk, setHostOk] = React.useState(hostRoutesUsable());
      const [busy, setBusy] = React.useState(false);
      const [frameKey, setFrameKey] = React.useState(0);
      const [frameLoaded, setFrameLoaded] = React.useState(false);
      const [note, setNote] = React.useState(null);
      /** 讲义那边推过来的「当前文件 + 选区」 */
      const [embedCtx, setEmbedCtx] = React.useState(null);
      const [sendState, setSendState] = React.useState(null);
      const alive = React.useRef(true);
      const propsRef = React.useRef(props);

      React.useEffect(() => () => { alive.current = false; }, []);

      /* 接收讲义 iframe 推来的「当前文件 + 选区」 */
      React.useEffect(() => {
        const onMessage = (event) => {
          const data = event?.data;
          if (!data || data.source !== 'studyhub' || data.type !== 'context') return;
          if (!alive.current) return;
          setEmbedCtx(data);
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
      }, []);

      /** 把 DSH 客户端 API 的形状回报给宿主：DSH 升级后"为什么发不出去"看这里。 */
      const probeHostApi = () => {
        try {
          const sessions = hostCtx?.get?.('sessions') ?? null;
          return {
            propsKeys: Object.keys(propsRef.current ?? {}).slice(0, 40),
            hasSessions: Boolean(sessions),
            sessionMethods: sessions ? Object.getOwnPropertyNames(Object.getPrototypeOf(sessions)).slice(0, 40) : null,
            currentId: (() => {
              try {
                if (typeof sessions?.currentSessionId === 'function') return sessions.currentSessionId();
                if (typeof sessions?.current === 'function') return sessions.current()?.id ?? null;
                if (sessions?.current?.id) return sessions.current.id;
              } catch (e) { return `throw: ${e?.message || e}`; }
              return null;
            })(),
          };
        } catch (err) {
          return { error: err?.message || String(err) };
        }
      };

      /**
       * 往当前会话发一条用户消息。
       * 这条路来自 dsh-learnharness 的实测：conversation.send 是"作用域寻址"的，
       * 必须在 session 作用域的 ctx 上调用，根 ctx 会抛 requires a session scope。
       */
      const sendToConversation = async (text) => {
        const ctx = hostCtx;
        if (!ctx) throw new Error('拿不到插件上下文');
        const sessions = (() => { try { return ctx.get?.('sessions') ?? null; } catch { return null; } })();
        if (!sessions) throw new Error('这个 DSH 版本没有暴露 sessions 服务');
        const sessionId = (() => {
          try {
            if (typeof sessions.currentSessionId === 'function') return sessions.currentSessionId();
            if (typeof sessions.current === 'function') return sessions.current()?.id ?? null;
            if (sessions.current?.id) return sessions.current.id;
            if (propsRef.current?.sessionId) return propsRef.current.sessionId;
          } catch { /* 试下一个取法 */ }
          return null;
        })();
        if (!sessionId) throw new Error('拿不到当前会话 id');
        const scoped = typeof sessions.scope === 'function' ? sessions.scope(sessionId) : null;
        if (!scoped) throw new Error('sessions.scope() 不可用');
        const conversation = (() => {
          try { return scoped.get?.('conversation') ?? null; } catch { return null; }
        })();
        if (!conversation || typeof conversation.send !== 'function') throw new Error('scoped ctx 上拿不到 conversation.send');
        await conversation.send(text);
      };

      /** 把「当前讲义 + 选中段落」作为一封信发进教学对话。 */
      const askWithContext = async () => {
        const context = embedCtx;
        if (!context) return;
        const lines = [];
        if (context.path) lines.push(`【当前讲义】${context.path}`);
        if (context.title) lines.push(`【标题】${context.title}`);
        if (context.selection) lines.push(`【我选中的这段】\n${context.selection}`);
        lines.push('\n请基于上面的材料回答。需要更多原文就用 study_read 去读，需要结构就用 study_outline。');
        setSendState({ phase: 'sending' });
        try {
          await sendToConversation(lines.join('\n'));
          if (alive.current) setSendState({ phase: 'ok' });
        } catch (err) {
          if (alive.current) setSendState({ phase: 'error', message: err?.message || String(err) });
          report({ sendError: err?.message || String(err), probe: probeHostApi() });
        }
      };

      const refresh = React.useCallback(async (options = {}) => {
        const value = await readStatus();
        if (!alive.current) return value;
        if (!options.quiet) setHostOk(diag.host === true);
        setStatus(value);
        // 首次 apply 时宿主路由可能还没注册好，所以成功之后补一次自检（30s 节流）
        if (value && Date.now() - lastReport > 30000) {
          lastReport = Date.now();
          report({ panel: 'refresh' });
        }
        return value;
      }, []);

      React.useEffect(() => {
        void (async () => {
          await refresh({ quiet: true });
          // 一次性的 API 形状快照，进 /studyhub/status 的 clientReport，升级后排查用
          report({ probe: probeHostApi(), at: 'mount' });
        })();
        const timer = setInterval(() => { void refresh({ quiet: true }); }, POLL_MS);
        return () => clearInterval(timer);
      }, [refresh]);

      const act = async (url) => {
        setBusy(true);
        setNote(null);
        try {
          const value = await fetchJson(url, { method: 'POST' });
          if (!alive.current) return;
          setStatus(value);
          setFrameLoaded(false);
          if (!value.online) setNote(value.error || '服务没起来，看看下面的日志');
        } catch (err) {
          setNote(`请求失败：${err?.message || err}`);
          setHostOk(false);
        } finally {
          if (alive.current) setBusy(false);
        }
      };

      const phase = phaseOf(status);
      const url = (status && status.online && status.url) || FALLBACK_URL;
      const frameUrl = decorate(url);
      const detail = note || (status && status.error) || '';
      const logTail = (status && Array.isArray(status.logTail) && status.logTail.length)
        ? status.logTail.slice(-12).join('\n')
        : '';

      const header = h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderBottom: `1px solid ${COLOR.line}`,
            flex: '0 0 auto',
            fontSize: 12,
            minHeight: 36,
          },
        },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 } },
          h(BookIcon, { size: 15 }),
          '学习台'),
        phase === 'online'
          ? pill(phaseText(phase), COLOR.ok)
          : phase === 'error'
            ? pill(phaseText(phase), COLOR.bad)
            : phase === 'starting'
              ? pill(phaseText(phase), COLOR.warn)
              : pill(phaseText(phase), COLOR.muted),
        hostOk ? null : h('span', { style: { color: COLOR.warn } }, '宿主路由不可达 · 用固定地址'),
        h('span', { style: { flex: 1 } }),
        hostOk
          ? button(busy ? '处理中…' : (phase === 'online' ? '重启服务' : '启动服务'), () => {
            void act(phase === 'online' ? RESTART_URL : START_URL);
          }, { disabled: busy })
          : null,
        button('重新加载', () => {
          setFrameLoaded(false);
          setFrameKey((k) => k + 1);
          if (hostOk) void refresh();
        }),
        button('材料栏', () => {
          if (!openMaterialPane(hostCtx)) setNote('这个 DSH 版本没有右栏页签（sidebarRightTabs）');
        }, { title: '在右栏打开讲义，边聊边读' }),
        button('在新标签打开', () => {
          try {
            window.open(url, '_blank', 'noopener,noreferrer');
          } catch {
            /* 被拦截就算了 */
          }
        }),
      );

      const banner = detail
        ? h('div', {
          style: {
            padding: '6px 10px',
            fontSize: 12,
            color: COLOR.bad,
            borderBottom: `1px solid ${COLOR.line}`,
            whiteSpace: 'pre-wrap',
            maxHeight: 120,
            overflow: 'auto',
            flex: '0 0 auto',
          },
        }, detail)
        : null;

      // 讲义推过来的上下文 + 「交给 DSH 对话」入口（三合一里"陪读被吞掉"的那一步）
      const contextStrip = embedCtx
        ? h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            fontSize: 11,
            color: COLOR.muted,
            borderBottom: `1px solid ${COLOR.line}`,
            flex: '0 0 auto',
            minHeight: 28,
          },
        },
        h('span', { style: { fontWeight: 600, color: 'inherit' } },
          `当前：${(String(embedCtx.path || '').split('/').pop()) || '（未打开文件）'}`),
        embedCtx.selection
          ? h('span', { style: { opacity: 0.72 } }, `· 已选 ${String(embedCtx.selection).length} 字`)
          : null,
        h('span', { style: { flex: 1 } }),
        sendState?.phase === 'error'
          ? h('span', { style: { color: COLOR.bad, maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            sendState.message)
          : null,
        sendState?.phase === 'ok'
          ? h('span', { style: { color: COLOR.ok } }, '已发进对话')
          : null,
        embedCtx.selection
          ? button(sendState?.phase === 'sending' ? '发送中…' : '把这段发给 DSH', () => { void askWithContext(); },
            { disabled: sendState?.phase === 'sending', title: '把当前讲义 + 选中段落作为一条消息发进对话' })
          : button('把这一章发给 DSH', () => { void askWithContext(); },
            { disabled: sendState?.phase === 'sending' }),
        )
        : null;

      const frame = h(
        'div',
        { style: { position: 'relative', flex: '1 1 auto', minHeight: '70vh' } },
        h('iframe', {
          key: frameKey,
          src: frameUrl,
          title: 'agent 学习平台',
          allow: 'clipboard-read; clipboard-write; fullscreen',
          allowFullScreen: true,
          referrerPolicy: 'no-referrer',
          onLoad: () => setFrameLoaded(true),
          style: {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: '0',
            background: 'transparent',
          },
        }),
        frameLoaded
          ? null
          : h('div', {
            style: {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              color: COLOR.muted,
              pointerEvents: 'none',
            },
          }, phase === 'starting' ? '平台正在启动…' : `正在加载 ${frameUrl}`),
        logTail
          ? h('details', {
            style: {
              position: 'absolute',
              left: 8,
              bottom: 8,
              maxWidth: 'min(560px, 90%)',
              fontSize: 11,
              background: 'rgba(0,0,0,.04)',
              borderRadius: 8,
              padding: '4px 8px',
              color: COLOR.muted,
            },
          },
          h('summary', { style: { cursor: 'pointer' } }, '服务日志'),
          h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', margin: '6px 0 0' } }, logTail))
          : null,
      );

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '70vh' } },
        header,
        contextStrip,
        banner,
        frame,
      );
    }

    /* ───────────────── 右栏「材料栏」───────────────── */

    const PANE_ID = 'studyhub';

    /** 右栏里那一小块：细条 + iframe。塞不进大顶栏，所以砍到最小。 */
    function MaterialPane(props) {
      const [status, setStatus] = React.useState(null);
      const [frameLoaded, setFrameLoaded] = React.useState(false);
      const [current, setCurrent] = React.useState('');
      const [note, setNote] = React.useState('');
      const alive = React.useRef(true);
      const frameRef = React.useRef(null);

      React.useEffect(() => () => { alive.current = false; }, []);

      /** 回执给讲义（它在 iframe 里，用它自己的 toast 显示结果） */
      const ackToFrame = (payload) => {
        try {
          frameRef.current?.contentWindow?.postMessage({ source: 'dsh', type: 'ask-ack', ...payload }, '*');
        } catch { /* 跨源失败就算了 */ }
      };

      /**
       * 把一条消息发进当前会话。
       * 这个座位（sidebar.right.pane.tab）的标准 props 里自带 sessionId，
       * 所以不用去猜 sessions.currentSessionId()。
       */
      const sendIntoConversation = async (text) => {
        const node = hostCtx;
        if (!node) throw new Error('没有插件上下文');
        const sessions = (() => {
          try { return node.get?.('sessions') ?? null; } catch { return null; }
        })();
        if (!sessions) throw new Error('这个 DSH 版本没有 sessions 服务');
        const sid = props?.sessionId;
        if (!sid) throw new Error('这个座位没拿到 sessionId');
        const scoped = typeof sessions.scope === 'function' ? sessions.scope(sid) : null;
        if (!scoped) throw new Error('sessions.scope() 不可用');
        const conversation = (() => {
          try { return scoped.get?.('conversation') ?? null; } catch { return null; }
        })();
        if (!conversation || typeof conversation.send !== 'function') throw new Error('拿不到 conversation.send');
        await conversation.send(text);
      };

      React.useEffect(() => {
        const onMessage = async (event) => {
          const data = event?.data;
          if (!data || data.source !== 'studyhub') return;
          if (data.type === 'context') {
            if (alive.current) setCurrent(String(data.path || '').split('/').pop() || '');
            return;
          }
          // 讲义里划词 → 交给 DSH 的对话回答（不再用平台自己的 Key）
          if (data.type === 'ask') {
            const selection = String(data.selection || '').trim();
            if (!selection) return;
            const lines = [];
            if (data.path) lines.push(`【当前讲义】${data.path}`);
            if (data.title) lines.push(`【标题】${data.title}`);
            lines.push(`【我选中的这段】\n${selection}`);
            lines.push('\n请解释这段。需要更多原文用 study_read，需要结构用 study_outline。');
            try {
              await sendIntoConversation(lines.join('\n'));
              if (alive.current) setNote('');
              ackToFrame({ ok: true });
            } catch (err) {
              const message = err?.message || String(err);
              diag.errors.push(`ask: ${message}`);
              if (alive.current) setNote(`发送失败：${message}`);
              ackToFrame({ ok: false, message });
            }
          }
        };
        window.addEventListener('message', onMessage);
        void readStatus().then((value) => { if (alive.current) setStatus(value); });
        return () => window.removeEventListener('message', onMessage);
      }, []);

      const url = (status && status.online && status.url) || FALLBACK_URL;
      const frameUrl = decorate(url);

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '60vh' } },
        h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            fontSize: 11,
            color: COLOR.muted,
            borderBottom: `1px solid ${COLOR.line}`,
            flex: '0 0 auto',
            minHeight: 26,
          },
        },
        h('span', { style: { fontWeight: 600 } }, '讲义'),
        current ? h('span', { style: { opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, current) : null,
        h('span', { style: { flex: 1 } }),
        note ? h('span', { style: { color: COLOR.bad, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '50%' } }, note) : null,
        button('新标签打开', () => { try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ } }),
        ),
        h('div', { style: { position: 'relative', flex: '1 1 auto', minHeight: '50vh' } },
          h('iframe', {
            ref: frameRef,
            src: frameUrl,
            title: 'agent 学习平台 · 材料栏',
            allow: 'clipboard-read; clipboard-write; fullscreen',
            allowFullScreen: true,
            referrerPolicy: 'no-referrer',
            onLoad: () => setFrameLoaded(true),
            style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: '0', background: 'transparent' },
          }),
          frameLoaded ? null : h('div', {
            style: {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: COLOR.muted,
              pointerEvents: 'none',
            },
          }, '加载讲义…'),
        ),
      );
    }

    /** 左下角那个小按钮：唯一的入口，点它只在右栏开讲义，绝不顶掉对话。 */
    function MaterialFooter() {
      return h(
        'button',
        {
          type: 'button',
          title: '打开讲义（右栏）',
          onClick: () => { openMaterialPane(hostCtx); },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            fontSize: 12,
            borderRadius: 7,
            border: `1px solid ${COLOR.line}`,
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          },
        },
        h(BookIcon, { size: 14 }),
        '讲义',
      );
    }

    /** 打开右栏材料栏（宿主没这个能力就返回 false）。 */
    const openMaterialPane = (ctx) => {
      try {
        const right = ctx.get?.('sidebarRight') ?? null;
        if (!right || typeof right.openTab !== 'function') return false;
        right.openTab(PANE_ID);
        return true;
      } catch (err) {
        diag.errors.push(`openTab: ${err?.message || err}`);
        return false;
      }
    };

    /** 右栏页签：类型 → 主体 → 标题，三件套 key 必须一致。 */
    const registerMaterialPane = (ctx) => {
      try {
        const kinds = ctx.get?.('sidebarRightTabs') ?? null;
        const slots = ctx.slots ?? ctx.get?.('slots');
        if (!kinds || typeof kinds.register !== 'function' || !slots) {
          diag.errors.push('material-pane: 宿主没有 sidebarRightTabs');
          return false;
        }
        const disposers = [];
        disposers.push(kinds.register({
          id: PANE_ID,
          kind: PANE_ID,
          priority: 'extension',
          title: () => '讲义',
          guide: [{
            id: 'studyhub-guide',
            order: 45,
            title: () => '讲义',
            description: () => '边聊边读：课程目录、正文、练习区',
            icon: SidebarMark,
          }],
        }));
        disposers.push(slots.register({ name: 'sidebar.right.pane.tab', key: PANE_ID }, MaterialPane));
        disposers.push(slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: PANE_ID,
        }, () => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
          h(BookIcon, { size: 13 }), '讲义')));
        diag.ok.push('material-pane');
        try {
          if (typeof ctx.effect === 'function') {
            ctx.effect(() => () => {
              for (const off of disposers) { try { off?.(); } catch { /* ignore */ } }
            }, 'studyhub-client.material-pane');
          }
        } catch { /* ignore */ }
        return true;
      } catch (err) {
        diag.errors.push(`material-pane: ${err?.message || err}`);
        return false;
      }
    };

    /** 注册一个座位；失败只记录，不抛。返回 true/false。 */    const safeRegister = (ctx, slotName, spec, Component, tag) => {
      try {
        const slots = ctx.slots ?? ctx.get?.('slots');
        if (!slots) {
          diag.errors.push(`${tag}: ctx.slots 不存在`);
          return false;
        }
        if (typeof slots.inject === 'function') {
          slots.inject(slotName, () => slots.register(spec, Component));
        } else {
          slots.register(spec, Component);
        }
        diag.ok.push(tag);
        return true;
      } catch (err) {
        diag.errors.push(`${tag}: ${err?.message || err}`);
        console.error(`[studyhub] 注册 ${tag} 失败：`, err?.message || err);
        return false;
      }
    };

    return {
      inject: ['slots'],
      apply(ctx) {
        hostCtx = ctx;
        /* 主区（main）**故意不注册**：那是 DSH 对话的位置。
           一旦注册 main，用户点图标就会把对话整块顶掉——这正是"两个界面"观感的根源。
           讲义只作为右栏材料栏存在。 */

        // 左下角小按钮：打开右栏讲义（不碰主区）
        safeRegister(ctx, 'sidebar.footer.action', {
          name: 'sidebar.footer.action',
          id: PLUGIN_ID,
          order: 40,
          label: () => '讲义',
        }, MaterialFooter, 'sidebar.footer.action');

        // 右栏「材料栏」：会话在中间，讲义在旁边（这是「边聊边读」的形态）
        registerMaterialPane(ctx);

        try {
          if (typeof ctx.effect === 'function') {
            ctx.effect(() => () => {}, 'studyhub-client.lifecycle');
          }
        } catch (err) {
          diag.errors.push(`effect: ${err?.message || err}`);
        }

        // 让宿主把客户端的注册结果带进 /studyhub/status，升级后一眼看出哪层断了
        void (async () => {
          await readStatus();
          report({ slots: Boolean(ctx.slots ?? ctx.get?.('slots')) });
        })();

        try {
          window.__studyhub = { ok: diag.ok, errors: diag.errors, host: diag.host, panel: PLUGIN_ID };
        } catch {
          /* 无所谓 */
        }
      },
    };
  },
});
