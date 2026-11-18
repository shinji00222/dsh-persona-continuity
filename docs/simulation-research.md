# DSH 模拟任务 · 技术调研

对应 [实现规划](simulation-plan.md)。2026-11-17 静态核对。第三方框架和数据源未接入 DSH 实测。

| 来源 | 证据 → 实现取舍 |
| --- | --- |
| 本地人格续忆 | 已有 DSH 模型调用、SQLite 租约和有限重试；记忆有摘要、细节及来源。复用调用和队列机制，模拟队列独立保留失败项，模拟角色独立存储。[Store](../lib/store.js) · [宿主入口](../index.js) |
| 本地 SimWorld（MIT） | `SimulationService.snapshot/fork` 固定状态并独立继续。借鉴快照与分叉，问卷只冻结实际使用的输入。原仓库无需修改。 |
| StanfordHCI/genagents（MIT） | 筛选受访者，按人并发提交整份问卷，Agent 单独加载记忆。借鉴按角色分派和汇总；用 DSH 模型和现有 SQLite 模式实现可恢复任务。[派发源码](https://github.com/StanfordHCI/genagents/blob/96854071ef4c2d79c93144c973c7820722d52bab/environment/survey/survey.py) · [记忆源码](https://github.com/StanfordHCI/genagents/blob/96854071ef4c2d79c93144c973c7820722d52bab/genagents/genagents.py) |
| Digital-Twin-Simulation（Apache-2.0） | 持久化并验证模型输出；评估只比较两侧对齐且有效的题与受访者。借鉴对齐及留出验证，首版实现分组分布差，配对答案可用后再加个体准确率。[执行](https://github.com/tianyipeng-lab/Digital-Twin-Simulation/blob/f1eed510c9a4fb47aaa9bb46e178aaa2d9224623/text_simulation/run_LLM_simulations.py) · [评估](https://github.com/tianyipeng-lab/Digital-Twin-Simulation/blob/f1eed510c9a4fb47aaa9bb46e178aaa2d9224623/evaluation/mad_accuracy_evaluation.py) |
| SurveyJS（MIT） | 分开校验问卷和答案，以稳定题目键与选项值定位错误。直接借鉴约定。首版自有轻量模型，复杂表单再评估引库。[校验文档](https://github.com/surveyjs/survey-library/blob/f5ff00c94392354432892566b09e533107f4429d/docs/survey-json-validation.md) |
| AgentSociety（Apache-2.0） | 显式定义问卷及题型，适合参考未来互动实验。首版独立问卷用有界并发执行。[问卷源码](https://github.com/tsinghua-fib-lab/AgentSociety/blob/a4882a712a579ffb07f85f8d41748061d023460b/examples/prospect_theory/surveys.py) |

## 数据与验证

- **外部适配器**。Kobo KPI v2 用表单答卷列表和分页链接；ODK Central OData 用 `@odata.nextLink`。先用测试端点验收授权、分页、字段映射及幂等；平台实测依赖可访问的表单和凭据。[Kobo API](https://github.com/kobotoolbox/docs/blob/master/source/api.md) · [Kobo 分页](https://community.kobotoolbox.org/t/important-changes-to-api-v2-assets-uid-asset-data-result-limits/74610) · [ODK OData](https://docs.getodk.org/central-api-odata-endpoints/)
- **非医疗基准**。Twin-2K-500（数据 CC BY 4.0）有多轮真人问卷。只用与待测题分离的角色背景，记录所选题块和轮次。全量画像可能包含待测答案，需要先审计。[数据卡](https://huggingface.co/datasets/LLM-Digital-Twin/Twin-2K-500)
- **校准边界**。平均值吻合仍可能掩盖分布和分组偏差。首版保留逐题逐组的选项计数、分母和缺答数；固定输入并重复运行以检查模型波动，用留出真人答卷验证调整。[真人对照研究](https://doi.org/10.1017/pan.2024.5)
