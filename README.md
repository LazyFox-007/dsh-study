# dsh-study

把本机的 **agent 学习平台**（Python，`127.0.0.1:8777`）接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：
**会话在主区，讲义在右栏，教学在对话里。**

> 这里只放**我们写的**插件。教学法来自 [LearnHarness](https://github.com/amosblomqvist/learnharness)
> 的第三方 DSH 插件（AGPL-3.0），我们不复制它的代码，只与它协作——原因见 [docs/learnharness.md](docs/learnharness.md)。

---

## 一、这个仓库解决什么问题

### 协同版 = 三件套

想"装完就能上课"，需要三样东西，缺一个都不成立：

| # | 东西 | 是什么 | 从哪来 |
|---|---|---|---|
| 1 | **本插件** `studyhub` | 材料通道 + 右栏讲义 + 划词 + 语言包/私有库 | 本仓库 |
| 2 | **教学法插件** `dsh-learnharness` | 探底 / 依赖图 / 承诺答案键 / 判分 | npm，AGPL-3.0，**独立安装** |
| 3 | **学习平台** `agent-learning-platform` | 讲义、全文搜索、练习区（能跑代码） | 另一个仓库（Python） |

**一步步的安装说明 → [docs/setup.md](docs/setup.md)**
**先跑一次环境自检 → `powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1`**（只检查、不改你的环境）

### 光有本插件能干什么

| 你有 | 缺 | 本插件补上 |
|---|---|---|
| 37 章课程、全文搜索、练习区（能跑代码） | 模型看不到它们 | 4 个只读工具 `study_*` |
| 一个网页，得切窗口 | 在 DSH 里看不见 | 右栏「讲义」页签（iframe） |
| 会话里选一段想问 | 要复制粘贴 | 讲义划词 → 直接发进对话 |
| 12 个学习工具混在写代码的会话里 | 工具表被污染 | 「学习模式」preset，只挂该有的 |

## 二、装

```text
plugin_manager install_bundle
target: <本仓库路径>\plugins\studyhub
```

或命令行（web profile）：

```bash
dsh plugin --profile web add <本仓库路径>/plugins/studyhub
```

装完刷新页面：左下角出现「讲义」按钮，右栏出现「讲义」页签，新会话的模式里多出「学习模式」。

## 三、插件做了什么

| 半边 | 文件 | 职责 |
|---|---|---|
| Host | `index.js` | 探活 / 拉起 / 停下 Python 服务；`/studyhub/*` 状态路由；注册只读工具；注册「学习模式」preset |
| Client | `client.js` | 右栏「讲义」页签 + 左下角入口；把讲义的划词转发进对话 |
| 工具 | `lib/tools.js` | 10 个 `study_*` 工具 |
| 语言 schema | `lib/tool-schema.js` | 拿不到 `defineTool` 时的 DSL→JSONSchema 兜底 |

### 10 个工具

| 工具 | 干什么 |
|---|---|
| `study_tree` / `study_search` / `study_outline` / `study_read` | 取材料：列目录、全文搜、看结构、读正文（默认截断 4000 字） |
| `study_lang_list` / `study_lang_install` / `study_lang_remove` | 给编辑器装/卸**语言包**（声明式，无脚本） |
| `study_py_list` / `study_py_install` / `study_py_clear` | 私有 Python 库（`pip --target`，先探测系统已装、只补缺） |

### 「学习模式」preset

一个会话级组合：`persona`（教师+陪读人设）+ 只读文件 + 提问 + 联网 + 压缩。
**不含** shell、子代理、workflow、office——那些是"干活"的工具。

## 四、配套的平台侧改动

本插件依赖学习平台提供这些接口（都在 `_webapp` 里，不在本仓库）：

| 接口 | 用途 |
|---|---|
| `GET /api/ping` | 存活探针 |
| `GET /api/tree` `GET /api/search` `GET /api/file` | 材料通道 |
| `GET/POST /api/ide/languages` | 语言包列表 / 安装 |
| `GET/POST /api/ide/pylibs` `POST /api/ide/pylibs/clear` | 私有库 |
| `POST /api/ide/run` | 跑代码（按扩展名自动选语言） |
| `?embed=1` | 讲义以嵌入模式打开：隐陪读、把选区和当前文件 `postMessage` 给宿主 |

## 五、兼容性

在 **DSH 0.2.2-rc.5（desktop profile）** 上实测通过。DSH 更新频繁且是破坏性的，我们只依赖四个契约，
断了怎么改见 [docs/compatibility.md](docs/compatibility.md)。所有注册点都独立 try/catch，
任何一条失效只会降级（例如面板退化成"固定地址 + 新标签打开"），不会白屏。

## 六、许可

MIT，见 [LICENSE](LICENSE)。

教学中使用的第三方插件 `dsh-learnharness` 是 **AGPL-3.0**，本仓库**不包含**它的代码，
只提供安装说明。两者在同一个 DSH 里独立运行，互不链接。

为什么"依赖"而不"搬"、什么情况下才会出问题、真要 vendor 该怎么做——
单独写了一篇：[docs/license.md](docs/license.md)。
