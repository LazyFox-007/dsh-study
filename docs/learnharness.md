# 与 LearnHarness / dsh-learnharness 的配合

## 一、为什么不把上游应用搬过来

LearnHarness 是一个完整的 Next.js 16 + Electron 44 桌面应用（约 1257 个文件、17.4 MB）。
其中大部分是**它不得不自己造、而 DSH 已经有的东西**：会话模型、agent 循环、模型供应商、
子代理、附件、听写。

真正构成"学习 harness"的只有三样（见 [IMPROVEMENTS.md](../IMPROVEMENTS.md)）：承诺答案键、
暂停与回灌、位置从调用派生。这三样已经在社区插件 `dsh-learnharness` 里实现了。

所以我们的定位是：**它管怎么教，我们管教什么。**

```
         ┌──────────── DSH 会话（唯一 AI 入口）───────────┐
         │  agent preset「学习模式」                       │
         │  人设 = 教师 + 陪读                             │
         │  工具 = learn_*（方法） + study_*（材料）       │
         └───────┬─────────────────────────┬─────────────┘
     教学法      │                         │  材料
    ┌────────────▼──────────┐   ┌──────────▼────────────────┐
    │ dsh-learnharness      │   │ studyhub（本仓库）         │
    │ AGPL-3.0 · 独立安装   │   │ MIT · 读平台 /api/*        │
    └───────────────────────┘   └───────────────────────────┘
```

## 二、装它

```text
plugin_manager install_bundle
target: dsh-learnharness
```

装完重启 DSH（宿主半边的插件模块在一个进程里只 import 一次）。

它会把 8 个 `learn_*` 工具**全局注册**（作者自己列在已知限制里）。用「学习模式」会话可以
把它和 `study_*` 一起用，但不影响标准模式——工具是全局的，这一条是它的限制，不是我们的。

## 三、许可边界（重要）

| | 许可 | 怎么处理 |
|---|---|---|
| LearnHarness 应用 | AGPL-3.0 | 不复制、不 fork |
| `dsh-learnharness` 插件 | AGPL-3.0 | **不并入本仓库**，独立安装；自用无义务，发布时注意 |
| 本仓库 `studyhub` | MIT | 与上面两者是"同一运行时里的独立程序"，没有代码链接 |

我们**没有**把 AGPL 代码放进本仓库。如果你要二次分发整个组合，请分别遵守各自许可。

## 四、数据目录

`dsh-learnharness` 把教学状态写在：

```
$DSH_HOME/learn/
├── sessions.json        会话 ↔ 主题绑定
├── pending-index.json   callId → 主题
└── <slug>/
    ├── topic.json       目标 / 阶段 / strands / 计划 DAG / 已访问节点
    ├── pending.json     已承诺、未作答的题（含答案键，**只在磁盘**）
    └── log.jsonl        作答历史
```

本插件**只读材料，不写这个目录**。两者的交集只有：同一个会话里，模型同时拿着 `study_*` 和 `learn_*`。

## 五、一次典型的学习会话

```
用户：教我第 20 章「上下文工程」里"注意力稀释"为什么是伪命题
  study_search("上下文工程")        → 定位 chapter_20
  study_outline(chapter_20)         → 看结构，挑一个推理步
  study_read(chapter_20, 6000)      → 取那段材料
  learn_start(goal=...)             → 绑定主题
  learn_probe_question(...)         → 先探底，一次一题
  learn_probe_done(strands)         → 写边界评估
  learn_plan(mermaid DAG)           → 画依赖图
  learn_quiz(correctAnswer=...)     → 出题（答案键先承诺，服务端判分）
```
