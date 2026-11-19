# 兼容性：DSH 更新后哪里会断，怎么改

DSH 目前是 `0.2.2-rc.x`，API 会破坏性变化。本插件只依赖下面四个契约，按"最容易变"排序。

排查第一步永远是：

```bash
curl "http://127.0.0.1:<DSH端口>/studyhub/status"
```

一次给出：`dsh.version` / `dsh.profile` / `dsh.capabilities`（四项探测）/ `dsh.registrations`
（注册成败）/ `dsh.errors`（原始错误）/ `logTail`。**先看这里，不要猜。**

| 契约 | 用在哪 | 断了的表现 | 怎么改 |
|---|---|---|---|
| `window.__ModuleLoader__.load({ id, factory })` | `client.js` 第 1 行 | 左栏无入口、右栏无页签，但状态路由正常 | 换成新版加载方式，`factory` 内的 `{ inject, apply }` 跟着调整 |
| `ctx.get('webServer').register({ kind, path, handler })` | `index.js` 路由注册 | `capabilities.webServer=false`，面板退化成"固定地址" | 换传输方式（例如改 Remote / Typert），或临时只保留工具、放弃状态接口 |
| `ctx.get('tools').register(definition)` | `index.js` 工具注册 | 工具表里没有 `study_*`，`registrations.tools` 为 0 | 按新版 ToolDefinition 调整 `defineTool` 兜底（见 `lib/tool-schema.js`） |
| `sidebar.right.pane.tab` 三件套 + `ctx.sidebarRightTabs.register` / `sidebarRight.openTab` | `client.js` 材料栏 | `clientReport.errors` 里有 `material-pane:` 开头的原文 | 换座位（`main` 已证明会顶掉对话，不建议回去），或退化成"新标签打开" |

另外两个**易踩的时序坑**（都真实发生过）：

1. **插件可能比 `webServer` 先装配** → `ctx.get('webServer')` 返回 undefined。
   直接写 `ctx.webServer` 会抛 `cannot get property "webServer" without inject`。
   所以我们对每个服务都是「可选取 + 500ms 重试，最多 30 秒」。
2. **宿主侧代码改动需要重启 DSH**：插件模块在一个进程里只 import 一次，
   禁用/启用只会重跑 `apply()`，不会重新读文件。客户端半边改完刷新页面即可。

## 怎么快速自检

```bash
# 宿主半边：假 ctx，不拉 Python、不碰真实 $DSH_HOME
node scripts/smoke.mjs

# 真拉起 Python 跑一遍生命周期 + 4 个读工具
node scripts/live-test.mjs
```
