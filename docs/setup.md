# 协同版安装（学习台 + 教学法）

想"装完就能上课"，需要三件东西。缺任何一个都不成立：

| # | 东西 | 是什么 | 从哪来 |
|---|---|---|---|
| 1 | **本插件** `studyhub` | 材料通道 + 右栏讲义 + 划词 + 语言包/私有库 | 本仓库 `plugins/studyhub` |
| 2 | **教学法插件** `dsh-learnharness` | 探底 / 依赖图 / 承诺答案键 / 判分 | npm（AGPL-3.0，**独立安装**，不在本仓库） |
| 3 | **学习平台** `agent-learning-platform` | 讲义、全文搜索、练习区（能跑代码） | [Gitee](https://gitee.com/haveink/agent-learning-platform) · [GitHub](https://github.com/LazyFox-007/Agent-Learning) |

> 本插件只负责"接"，不含讲义内容。没有第 3 项，工具会如实报"平台不在线"。

---

## 一、装平台（第 3 项）

```powershell
# Gitee（国内快）
git clone https://gitee.com/haveink/agent-learning-platform.git C:\StudyAI
# 或 GitHub 镜像
# git clone https://github.com/LazyFox-007/Agent-Learning.git C:\StudyAI

cd C:\StudyAI\_webapp
python server.py --ide          # 第一次手动起一次，确认能开 http://127.0.0.1:8777/
```

只需 **Python 3.8+，不用 `pip install` 任何东西**。**37 章课程讲义随仓库一起提供**（约 25 MB），
clone 下来就有材料，不需要另外下载。

要 Python 3.11+；`--ide` 才挂练习区（能跑代码）。看到 `本机访问 : http://127.0.0.1:8777/` 就可以了，
按 Ctrl+C 停掉——之后由插件托管。

## 二、装两个插件

在 DSH 里对 Agent 说（或直接在插件页安装）：

```text
plugin_manager install_bundle
target: <本仓库路径>\plugins\studyhub

plugin_manager install_bundle
target: dsh-learnharness
```

命令行等价（web profile）：

```bash
dsh plugin --profile web add <本仓库路径>/plugins/studyhub
dsh plugin --profile web add dsh-learnharness
```

**然后重启一次 DSH。** 宿主半边的插件模块在一个进程里只 import 一次，禁用/启用不会重读文件。

## 三、改一处配置

`~/.dsh/profiles/<你的 profile>/node_modules/dsh-studyhub/cordis.patch.yml`（或安装源里的同名文件）：

```yaml
- insert:
    - id: studyhub
      name: 'dsh-studyhub'
      config:
        platformDir: 'C:\StudyAI\_webapp'   # ← 改成你自己的平台目录
        python: 'python'                    # ← 建议写绝对路径
        port: 8777
        autoStart: true
        extraArgs: ['--ide']
```

改完再重启一次。

## 四、用（四步）

1. 刷新页面 → 左栏**左下角**出现「讲义」按钮
2. **新建会话** → 模式选「**学习模式**」
3. 点「讲义」→ 右栏出现讲义页签，边聊边读
4. 说一句：「**教我：<你想搞懂的东西>**」，或直接在讲义里划一段 → 点「问大肥鱼」

## 五、验收清单（4 条，全过才算装对）

| # | 检查 | 看到什么算对 |
|---|---|---|
| 1 | `curl http://127.0.0.1:<DSH端口>/studyhub/status` | `phase: online`、`tools: 10`、`errors: []` |
| 2 | 右栏「讲义」页签 | 能显示平台首页（章节卡片） |
| 3 | 新会话选「学习模式」 | 模式名出现在会话标题旁；只有少量工具（没有 shell） |
| 4 | 对话里说「第 2 章讲什么」 | 模型先 `study_search`/`study_read` 再回答，不是凭空编 |

## 六、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 面板显示「宿主路由不可达 · 用固定地址」 | 桌面版 renderer 不是 http 源，拿不到 `/studyhub/status`。不影响 iframe，用固定地址 8777 即可 |
| 工具报「学习平台当前不在线」 | 平台没起。点面板「启动服务」，或改 `platformDir`/`python` |
| 想跑 C++ / Rust | 需要本机有 `g++` / `rustc`；`study_lang_list` 会标出「缺 xxx」 |
| pip 装包很慢 | 国内网络；可设 pip 镜像：`pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple` |
| 「学习模式」没出现 | 插件没重启；或 `agentPresets` 注册失败，看 `/studyhub/status` 的 `registrations.preset` |
| 划词没反应 | 讲义必须以 `?embed=1` 打开（插件自动加的）；独立打开网页时走平台自己的陪读 |
