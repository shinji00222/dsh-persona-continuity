# Tobs 与人格续忆技术调研

核对日期为 2026-11-20。Tobs 源码固定在 `d904cf6129121b43d5540d9b2585b97922f9ac0d`，并核对了 [v1.7.0 发布版](https://github.com/BotHarness/DeepSeekBot/releases/tag/v1.7.0)的 Git 初始化和会话归属代码。人格续忆基线为本机 `677a6fb` 加当前工作区。已运行人格续忆的 `npm run check` 和 `npm test`，26 项基线测试通过。Tobs 集成尚未在 Windows 桌面实测。实施分工见[项目规划](tobs-integration-plan.md)。

## 复用清单

| 代码 | 可直接利用的部分 | 接入时要改的部分 |
| --- | --- | --- |
| 人格续忆 [`client.js`](../client.js)、[`lib/web.js`](../lib/web.js)、[`cordis.patch.yml`](../cordis.patch.yml) | 保留人格选择器、设置页、记忆查看与编辑交互、DSH 插槽注册和授权路由。 | 在 Tobs 的 Bot 入口里关联本地人格，适配记忆 API，去掉模拟面板、路由和发布入口。 |
| 人格续忆 [`index.js`](../index.js) | 复用会话绑定、`systemPrompt.section`、`agent/pre-step`、`persona_recall` 和轮次结束采集的现有实现，维持普通会话、子会话、无痕会话的过滤逻辑。 | Tobs 会话从宿主可信的 ownership 取 Bot 身份后映射人格。核对 hook 顺序和首请求，防止人格或记忆被注入两次。 |
| 人格续忆 [`lib/extract.js`](../lib/extract.js)、[`lib/history.js`](../lib/history.js) | 直接保留模型 JSON 调用、结束判定、输入截断、原文证据校验及按会话授权读取历史的逻辑。 | 提炼给当前人格的目标和已知主题，允许返回空结果。移除对模拟的依赖，补充同人格的后台回顾。历史读取继续通过宿主接口。 |
| 人格续忆 [`lib/store.js`](../lib/store.js) | 复用 `savePersona`、会话绑定、任务重试和恢复。抽出 `clean`、文本分词、工作区约束与 `search` 的排序逻辑。 | `catalog`、`detail`、`recall` 和记忆 CRUD 改读写人格 Markdown 目录。当前 `finish` 在同一 SQLite 事务内完成落库与任务确认，迁移后需靠任务幂等键和独立确认处理崩溃恢复。 |
| 人格续忆 [`test/binding.test.js`](../test/binding.test.js)、[`test/continuity.test.js`](../test/continuity.test.js)、[`test/history.test.js`](../test/history.test.js) | 复用首轮绑定、A/B 隔离、重启、中文召回、重试和历史范围的断言。 | 新增 Tobs 桌面请求记录、文件存储和路径隔离的验证。旧 `dsh-personal-manager` 的[记录式首请求测试](https://github.com/shinji00222/dsh-persona-routing/blob/46ffef6837241aa263cb0f4143d356ad23bf3d0a/tests/e2e/persona-first-request.spec.ts)可作为测试搭建参考。 |
| Tobs [Session Ownership](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/packages/core/src/sessions/ownership.ts)、[原生 DSH 运行适配器](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/packages/core/src/runtime/dsh-bot-agent-adapter.ts) | 在已安装宿主上复用 Bot 身份、频道、消息和执行。源码已有 `ownership.resolve(sessionId)` 关联 Bot，Tobs 自己的 `agent/pre-step` 也用它识别会话。 | `ctx.provide('botharness', core)` 是源码里观察到的宿主服务。需要验证独立 bundle 是否能依赖它、读取 owner，并且在首请求前取到映射。暂未确认这是稳定的第三方扩展接口。 |
| Tobs [engine-persona.ts](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/packages/core/src/engines/engine-persona.ts)、[engine-memory-tools.ts](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/packages/core/src/engines/engine-memory-tools.ts)、[jail.ts](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/packages/core/src/memory/jail.ts) | 可借鉴人格与记忆分段，以及对相对路径和符号链接的检查。 | engine 工具带 `SOUL.md` 和 Git 仓库语义，且是另一条执行路径的内部代码。首版继续用人格续忆的受控读写接口，模型只接触条目 ID。额外测试 Windows junction、别名路径及目录越界。 |

源码复用优先发生在现有人格续忆仓库内部。Tobs 以已安装插件作为运行依赖来验证，`@botharness/core` 的 [`package.json`](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/packages/core/package.json) 标记为 `private`，导出不包含上述内部模块。Tobs 采用 [MIT](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/LICENSE)，如实际移植代码，保留原版权和许可声明并记录来源提交。

## Tobs 接入的关键依赖

1. [Registry 创建路径](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/packages/core/src/bots/registry.ts#L607-L675)先建立记忆目录并放入初始文件，再调用初始化器。主线和 [v1.7.0 宿主](https://github.com/BotHarness/DeepSeekBot/blob/v1.7.0/packages/core/src/plugin.ts#L717-L741)都装配了 Git 初始化器。`memoryDir` 改的是位置。在本次检查的配置和装配路径中，未找到能把安装版切换成纯目录存储的开关。
2. [Memory Service](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/packages/core/src/memory/service.ts)还处理仓库变更、恢复及提交记录，Tobs 运行层会消费这些结果。Orchestrator 的恢复路径会比较工作目录，[运行适配器](https://github.com/BotHarness/DeepSeekBot/blob/d904cf6129121b43d5540d9b2585b97922f9ac0d/packages/core/src/runtime/dsh-bot-agent-adapter.ts#L1997-L2004)会拒绝不匹配的会话。小分支若成为必要方案，要保留会话工作目录约束并处理 Git 专属路径，单改初始化器不足以判断能否工作。
3. 接入优先验证独立 bundle。要同时证明可信身份可用、首次请求接上、一个新建 Bot 的长期记忆目录没有 `.git`、原有 Tobs 记忆没有第二条读写通道。若安装版无法关闭原有路径，向集成负责人交付复现和最小补丁清单，再决定采用 Tobs 小分支还是先交付可独立运行的 DSH 人格续忆。

## Claude 和 Codex 提供的设计依据

- [Claude Code Auto Memory](https://code.claude.com/docs/en/memory#auto-memory)的 Markdown 短索引和按需文件可直接用作目录设计。[Anthropic 的记忆研究](https://www.anthropic.com/research/components-of-agent-memory)建议让模型按任务判断哪些经历值得留，并用原始记录校正笔记。测试也显示弱模型可能需要明确提醒先查笔记、再核对证据，因此「自主选择」以目标模型的实测为准。
- [Codex 记忆流水线](https://github.com/openai/codex/blob/main/codex-rs/memories/README.md)的后台提炼与整合可借鉴。当前项目已有单轮提炼和重试，首版在其上补一个按人格回看来源、合并和修正的任务。每条笔记记录来源会话及轮次，方便点回原文。
