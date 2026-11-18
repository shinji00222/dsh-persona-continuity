# 人格续忆 · DSH Persona Continuity

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的每个「人格」一份独立的跨会话长期记忆；顺带把「让大模型扮演一群受访者填问卷，再用真人数据校准」做成了插件里的一个工作台。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![DSH](https://img.shields.io/badge/DSH-0.2.x-4B6EF5)
![version](https://img.shields.io/badge/version-0.2.0--preview.13-orange)

> Cross-session memory for each DeepSeek Harness persona, plus a survey simulation and calibration workbench for LLM-generated responses.

<!-- 录好 demo 后：把 gif 放到 docs/demo.gif，再去掉下一行注释 -->
<!-- ![演示](docs/demo.gif) -->

## 为什么做这个

DSH 的会话彼此独立：关掉一个会话，里面聊过的偏好、决定和进度就留在了里面。人格续忆让你在开新会话时选回同一个人格，它带着自己的记忆继续干活，不用每次重新交代背景。

同一套记忆、队列和 SQLite 底座还能干另一件事：让模型分别扮演几十上百个背景不同的受访者，各答一份问卷，再和真人答卷按题对比分布差异——这在做用户研究、问卷预测试或角色模拟时很有用。

## 功能

### 人格续忆

- **新建会话时选人格**：输入框旁点「普通会话」→「＋ 新建人格」，填个名字就能用；普通会话仍保持 DSH 原生行为。
- **每个人格独立记忆**：人格以稳定 ID 持有记忆，改名不丢；两个同时打开的会话可以用不同人格。
- **后台自动提炼**：成功轮次结束后，复用当前模型把偏好、决定、进度、经验提炼成条目并保存，可随时在「设置 → 人格续忆」里查看、修改、删除。
- **开场摘要 + 按需召回**：「继续上次」这类请求会带出同人格最近一个有记忆的会话；需要细节时模型按主题或条目 ID 取用。
- **查旧对话**：说「读往前第 3 段会话」「找之前聊 SQLite 的那段」，宿主在当前工作区里搜同人格最近 24 段会话，并把原文片段和来源送进请求。

### 模拟任务

- **问卷设计**：可视表单编辑，也可以从 Markdown / JSON / TSV 导入；支持单选题和开放题。
- **角色批次**：从 Excel 粘贴或导入 TSV（编号、名称、分组、背景），可复用、可分页。
- **并发作答**：每个角色单独一次模型请求，只带自己的背景和公共材料；并行数 1–12（默认 6），失败项可单独重试，宿主重启后可续跑。
- **逐人答卷与导出**：按运行、分组查看每个人的答案，整次运行导出 CSV。
- **真人校准**：导入真人选项人数（TSV / JSON），按题显示真人比例、模拟比例和百分点差，先预览再保存。

## 安装

要求 DSH 0.2.x（带 Web 客户端的桌面版或 Web 宿主，Node 支持 `node:sqlite`），Node.js ≥ 22.13。已在 DSH 0.2.2-rc.3 上验证。

```bash
npm pack
```

把生成的 `dsh-persona-continuity-<version>.tgz` 通过 DSH 插件管理器装进目标 profile，再重启该 profile。首次建议先建两个不同人格和一个普通会话试一遍。

## 使用

1. **选人格**：新会话输入框旁点「普通会话」，在菜单里选人格或「＋ 新建人格」。左键切换，右键人格条目可重命名。
2. **设定人格**：「设置 → 人格续忆」里填写人格设定，也可以在这里管理记忆条目。
3. **让它记事**：正常聊天即可；偏好、决定、进度和经验会在后台提炼入库。取消或未完整结束的轮次会跳过。
4. **继续上次**：新会话直接说「继续上次」，或按主题/会话 ID 让它去翻旧对话。
5. **跑模拟**：左侧栏「模拟任务」→ 设计问卷、导入角色批次 → 运行 → 看逐人答卷、导出 CSV → 在「校准」里导入真人数据做对比。

## 数据与隐私

- 记忆存在本地 SQLite：`$DSH_HOME/persona-continuity/memory.sqlite`，不上传、不跨设备同步。
- 提炼、召回和模拟作答都会把**必要的正文**交给当前会话使用的模型；插件自身不额外联网。
- 普通会话、子会话和无痕插件格式的会话不写入、不注入记忆。
- 提炼入参会过滤常见凭据格式（`sk-…`、`ghp_…`、`Bearer …` 等）后再保存。

## 项目结构

| 路径 | 作用 |
| --- | --- |
| `index.js` | 宿主入口：人格注入、提炼队列、历史检索、模拟执行 |
| `client.js` | Web 客户端：人格菜单、设置页、模拟任务面板 |
| `lib/store.js` | SQLite schema、人格 / 记忆 / 运行 / 答卷 |
| `lib/extract.js` | 模型调用、结构化解析与凭据过滤 |
| `lib/history.js` | 旧对话检索与范围隔离 |
| `lib/simulation.js` | 问卷、角色批次、并发运行与校验 |
| `lib/web.js` | 复用 DSH 鉴权的管理路由 |
| `test/` | `node:test` 单元测试 |

## 开发

```bash
npm run check   # 语法检查
npm test        # 单元测试
```

验收请用隔离的 `DSH_HOME` 起一个 profile，覆盖普通会话默认行为、两个并行人格、重启后的开场摘要、按 ID 读细节，以及模拟任务的导入、并发和校准。

## 文档

- [技术调研](docs/research.md) · [项目规划](docs/project-plan.md)
- [模拟任务 · 实现规划](docs/simulation-plan.md) · [模拟任务 · 技术调研](docs/simulation-research.md)
- [开发记录](docs/development-log.md)

## 许可

[MIT](LICENSE)
