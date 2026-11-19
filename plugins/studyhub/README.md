# dsh-studyhub · 学习台

把本机的 **agent 学习平台**（Python，`127.0.0.1:8777`）接进 DeepSeek Harness：
**会话在主区、讲义在右栏、教学在对话里。**

- 只读材料 → 4 个 `study_*` 工具
- 右栏「讲义」页签（iframe）+ 左下角入口
- 讲义划词 → 直接发进 DSH 对话
- 给编辑器装**语言包**、往**私有 Python 库**装包（不碰系统环境）
- 注册「学习模式」preset（人设 + 收窄的工具集）

教学法（探底 / 依赖图 / 承诺答案键 / 判分）来自第三方插件 `dsh-learnharness`，
本插件不包含它的代码，只与它协作。见 [仓库 README](../../README.md)。

---

## 装

```text
plugin_manager install_bundle
target: <本目录绝对路径>
```

装完刷新页面。宿主半边改动需要**重启 DSH**（插件模块在一个进程里只 import 一次）。

## 配置（`cordis.patch.yml`，全部可选）

| 字段 | 默认 | 说明 |
|---|---|---|
| `platformDir` | `C:\StudyAI\_webapp` | 有 `server.py` 的目录 |
| `python` | `python` | 解释器；建议绝对路径 |
| `port` | `8777` | 首选端口，占用时顺延 12 个 |
| `autoStart` | `true` | DSH 启动后自动探活/拉起（延迟 1.2s） |
| `extraArgs` | `['--ide']` | 传给 `server.py`；启动时总会追加 `--no-browser` |
| `startTimeoutMs` | `25000` | 等它上线 |
| `logDir` | `$DSH_HOME/studyhub/logs` | 服务日志 |
| `enableTools` | `true` | 是否注册 10 个 `study_*` 工具 |
| `excludePaths` | `['LearningHarness/']` | 全文搜索时跳过的前缀 |

## 状态路由

```
GET  /studyhub/status      ← 排查一切问题的第一步
GET  /studyhub/presets     ← 读现有 agent preset 的真实声明
GET  /studyhub/log
POST /studyhub/start | /restart | /stop
POST /studyhub/selfcheck   ← 客户端上报注册结果
```

`/status` 里值得先看的三段：`phase/online/url/pid/external`、`dsh.capabilities` + `dsh.registrations`、
`dsh.errors`。

## 工具

| 工具 | 说明 |
|---|---|
| `study_tree` `study_search` `study_outline` `study_read` | 取材料（只读） |
| `study_lang_list` `study_lang_install` `study_lang_remove` | 语言包 |
| `study_py_list` `study_py_install` `study_py_clear` | 私有 Python 库 |

## 测试

```bash
node scripts/smoke.mjs      # 假 ctx：路由 / 状态 / 自检 / 降级，不拉 Python
node scripts/live-test.mjs  # 真拉起 Python：生命周期 + 4 个读工具
```

## 已知限制

- 桌面版 renderer 不是 http 源 → 拿不到 `/studyhub/status`，面板退化为"固定地址 + 新标签打开"。
- `study_read` 没有行范围参数（大文件只能从头截断）。
- 私有库用 `pip --target`，不做包间冲突仲裁。
- 讲义 iframe 在窄的右栏里三栏会挤，需要平台侧 `?embed=1` 继续收窄布局。

MIT License.
