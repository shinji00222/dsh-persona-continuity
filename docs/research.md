# DSH 多人格长期记忆调研

调研日期 2026-11-17。核对了社区仓库文档和下列链接指向的源码，以及本机旧人格路由仓库。社区插件的兼容性和运行效果尚未在本机实测。

## 最接近的现有方案

| 项目 | 查到的做法 | 本项目可借鉴的地方 |
| --- | --- | --- |
| ifenc/dsh-persona-memory | 新对话默认关闭人设，人物卡各自拥有长期记忆。存储条目同时记录 `cardId` 和来源 `sessionId`，去重键包含 `cardId`。 | 借鉴「会话选卡、按卡存取」和按卡管理界面。未知或失效的人格 ID 应关闭本次记忆操作，避免同名卡或默认活动卡接管数据。该项目也支持模型直接修改记忆，本方案的确认由宿主代码执行。[文档](https://github.com/ifenc/dsh-persona-memory/blob/5d0e320e6619c561fa9af7a671f66e3d0867782d/README.md) · [存储源码](https://github.com/ifenc/dsh-persona-memory/blob/5d0e320e6619c561fa9af7a671f66e3d0867782d/lib/store.js) |
| shenA2024/whale-persona | 收件箱区分提议与确认，提供确认、拒绝和注入读取。改写提议等待确认时保留旧条目。安装脚本和市场安装的预设注册路径不同。 | 借鉴待确认收件箱和原子提交。待确认的替代项独立展示，批准时才取代旧版本。把确认权限与模型工具分开，装包后实际验证预设是否进入选择器。[文档](https://github.com/shenA2024/whale-persona/blob/c3d2886188b1a6df2329654da0780055e888f8d8/README.md) · [收件箱源码](https://github.com/shenA2024/whale-persona/blob/c3d2886188b1a6df2329654da0780055e888f8d8/core/memoryInbox.js) |
| ShiLaiM/dsh-persona-L | 会话单独绑定人格。静态人格和动态记忆采用不同的上下文入口，界面可管理人格和预览注入。 | 借鉴会话绑定与注入预览。首版将选择放在发送首条消息前，会话中途切换留待验证历史上下文的行为。[文档](https://github.com/ShiLaiM/dsh-persona-L/blob/78f55d63162860b8e1c73ada86d1721261d8c6ee/README.md) · [宿主源码](https://github.com/ShiLaiM/dsh-persona-L/blob/78f55d63162860b8e1c73ada86d1721261d8c6ee/index.js) |

已有项目分别覆盖了多人格隔离、人工确认和 Codex 式召回。新插件的首版应验证三者结合后的完整体验，尤其是旧会话恢复、普通会话和同名人格的边界。现阶段优先借鉴机制，具体是否依赖或复用代码留到接入验证后决定。上表项目均标注 MIT，复用源码时保留相应版权及许可声明。

## 跨会话记忆实现

- **haitang1/dsh-memory** 最接近 Codex 式记忆组织。它将单会话提炼、持久条目和紧凑的注入摘要分开，并在后台排队执行模型提炼。可借鉴异步、限时和输入预算；本项目里提炼结果先进入当前人格的待确认队列，自动合并已确认记忆可在后续评估。[文档与配置](https://github.com/haitang1/dsh-memory/blob/d0dea8e119eb34678d4fd33b503009d61d0770a5/README.md)
- **vpromise/dsh-memory** 通过 `session/event` 捕获事件，在 `turn/end` 触发相关处理，并用 `agent/pre-step` 注入有预算的上下文。可借鉴处理时机和来源过滤。项目以工作区或项目为记忆归属，本项目先按人格限定读写范围，再用项目和当前问题改善相关性。[宿主入口](https://github.com/vpromise/dsh-memory/blob/1e1109b08890e9b3aa12cce4962e28634a2cfe65/src/index.ts)
- **Culeot/dsh-agent-memory** 提供关键词召回、相关性阈值和注入上限。可借鉴「低于阈值就返回空」，尤其用中文关键词、代码符号和路径做验收。首版可用本地检索，以实际漏召回和误召回来决定是否加语义检索。[召回文档](https://github.com/Culeot/dsh-agent-memory/blob/73411b69ccca31cff974314de48c3273ef51c363/README.md) · [检索源码](https://github.com/Culeot/dsh-agent-memory/blob/73411b69ccca31cff974314de48c3273ef51c363/src/search.ts)

## 旧 Persona 路由项目

已核对 `dsh-personal-manager` 本地提交 `46ffef6`。它在 Super-agent 的 Ticket 首次派单前持久化 `personaId`、版本和注入正文快照，Worker 重试和重启继续复用绑定；`src/app/sessions.ts` 在 Agent 作用域注册人格段落。可复用的设计是**先绑定、再请求**，通过稳定 ID 恢复人格，给提示词定义保留版本信息，并让旧数据缺省时走原路径。旧项目按 Ticket 自动挑选五种工作策略，本项目的会话绑定以用户选择为准。[路由设计](https://github.com/shinji00222/dsh-persona-routing/blob/46ffef6837241aa263cb0f4143d356ad23bf3d0a/docs/009-persona-routing.md) · [会话提示词源码](https://github.com/shinji00222/dsh-persona-routing/blob/46ffef6837241aa263cb0f4143d356ad23bf3d0a/src/app/sessions.ts)

验收沿用旧项目的隔离 profile 和记录型假模型，用实际发给模型的第一条请求证明注入生效。同时增加负例，用 A、B 人格各自的唯一测试事实，检查 A 的第一条请求、B 的第一条请求、普通会话、重启恢复以及待确认记忆。旧项目本次仅检查源码和测试用例。[首请求验收用例](https://github.com/shinji00222/dsh-persona-routing/blob/46ffef6837241aa263cb0f4143d356ad23bf3d0a/tests/e2e/persona-first-request.spec.ts)

## DSH 接入验证

优先试用 DSH 原生 Agent 预设列表和 `dsh-persona`。上游支持在空白会话选择预设并记录身份，桌面版复用 Web 客户端。未确认的关键点是目标桌面版本能否通过公开接口从插件管理界面新增、编辑自定义人格，并在首请求前完成绑定。阶段 0 验证预设注册和创建路径，必要时在官方 UI 扩展槽做独立人格选择器。安装和新建人格皆应保留 DSH 当前默认会话行为。[预设注册](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset-registry/README.md) · [选择器](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-agent-preset/README.md) · [人格配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/persona/README.md) · [桌面架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)

## 0.1.0 实现取舍

- 包名采用 `dsh-persona-continuity`。GitHub 上已有 ifenc、Quophic 和 PaangGaaSam 使用 `dsh-persona-memory` 仓库名。2026-11-17 的 GitHub 仓库名称搜索和 npm 查询均未发现新包名的同名项。[ifenc](https://github.com/ifenc/dsh-persona-memory) · [Quophic](https://github.com/Quophic/dsh-persona-memory) · [PaangGaaSam](https://github.com/PaangGaaSam/dsh-persona-memory)
- 复核 ifenc 的实现后，确认所查版本按会话记录开关，人格提示、保存和检索读全局 `activeCardId`。首版保存 `sessionId → personaId`，提示和记忆工具都从实际发起请求的会话解析人格。可沿用其插件插槽与模型工具接入模式。[宿主源码](https://github.com/ifenc/dsh-persona-memory/blob/5d0e320e6619c561fa9af7a671f66e3d0867782d/index.js) · [存储源码](https://github.com/ifenc/dsh-persona-memory/blob/5d0e320e6619c561fa9af7a671f66e3d0867782d/lib/store.js)
- 保存方式按最新决定改为后台自动提炼并保存。上文的人工待确认是早期调研方案。借鉴 Codex 的开场摘要和按需索引，借鉴 haitang1 和 vpromise 的异步提炼及 DSH 事件接入。首版按主题更新结构化记忆。[Codex 说明](https://learn.chatgpt.com/docs/customization/memories) · [Codex 召回提示](https://github.com/openai/codex/blob/main/codex-rs/ext/memories/templates/memories/read_path.md) · [DSH 异步提炼](https://github.com/haitang1/dsh-memory) · [DSH 宿主事件](https://github.com/vpromise/dsh-memory/blob/1e1109b08890e9b3aa12cce4962e28634a2cfe65/src/index.ts)
