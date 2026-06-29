# Skill Spec: 42-config-author

## 1. 目标

基于已经完成的场景理解和能力核验结果，生成或修改 42 案例配置文件。

这个 skill 负责：

- 生成 `Inp_Sim.txt`
- 生成 `Orb_*.txt`
- 生成 `SC_*.txt`
- 视需要生成 `Inp_Cmd.txt`
- 视需要生成 `Inp_*Output.txt`

它不负责：

- 重新解释用户需求
- 重新做能力裁决
- 直接写 FSW 控制代码

## 2. 触发条件

满足以下条件时触发：

1. `aignc-scenario-brainstorm` 已完成
2. `42-capability-auditor` 已完成
3. 评估结果中：
   - `sim_config_support` 为 `supported` 或 `supported_with_assumptions`
4. 没有未关闭的阻塞问题

## 3. 输入

### 必要输入

- `scenario_facts.json`
- `open_questions.json`
- `capability_assessment.json`

### 可选输入

- 现有案例模板文件路径
- 用户指定的输出目录/命名规范
- 用户要求复用的现有 `InOut` 文件

## 4. 输出

### 4.1 配置文件集合

至少可能包括：

- `Inp_Sim.txt`
- `Orb_<case>.txt`
- `SC_<case>.txt`

按需包括：

- `Inp_Cmd.txt`
- `Inp_AcOutput.txt`
- `Inp_ScOutput.txt`

### 4.2 生成清单

`generated_config_manifest.json`

建议字段：

```json
{
  "files_created": [],
  "files_modified": [],
  "templates_reused": [],
  "assumptions_applied": [],
  "manual_followup_needed": []
}
```

### 4.3 人类可读摘要

`config_generation_summary.md`

建议内容：

1. 生成了哪些文件
2. 关键配置决策
3. 沿用了哪些模板
4. 应用的默认值和假设
5. 还未覆盖的部分

## 5. 读取哪些知识库

### 主层默认读取

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/examples.md`

### 结构化索引默认读取

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/inputs.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/orbit_env.json`

### 按需读取 details

仅在要落具体文件时读取：

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/inp_sim.schema.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/orb.schema.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/sc.schema.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/inp_cmd.schema.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/output_files.schema.json`
- 对应传感器与执行机构 schema

## 6. 工作流

### Step 1. 选择模板策略

对每个目标文件类型先判断：

- 从零生成
- 从现有 `InOut/` 案例拷贝后修改
- 从 `Demo/` 模板迁移

优先原则：

- 优先复用最接近的现有模板
- 不做无意义的从零重写

### Step 2. 生成最小可运行配置

先保证：

- 42 能读
- 案例能跑
- 文件间引用一致

不要一开始就追求所有输出项都完美。

### Step 3. 再补验证与诊断输出

仅当用户明确要图、报告、诊断时，再生成输出控制文件。

### Step 4. 写生成清单

把：

- 使用了哪些模板
- 应用了哪些默认值
- 哪些地方是保守假设

写进 `generated_config_manifest.json`

## 7. 必须停止并提问的条件

以下情况必须停：

1. 轨道体制或参考天体不明确
2. 平台星数不明确
3. 关键执行机构未定，但会影响 `SC_*.txt` 主体结构
4. 用户同时要求互斥配置
5. 需要写入的字段在 schema 中不存在且未被能力核验标记为允许扩展

## 8. 不允许做的事情

- 不自己补出未核验的新物理能力
- 不把 `requires_extension` 的对象静默写进配置
- 不在没有依据时生成复杂 `Inp_Cmd` 时序

## 9. 成功标准

1. 配置文件之间引用一致
2. 至少能形成最小可运行案例
3. 所有假设都可追踪
4. 下游运行 skill 可以直接消费这些文件

## 10. 最小示例

输入：

- 单星、600 km SSO、四轮金字塔、三磁力矩器、CFS_FSW、自定义 ADCS

输出重点：

- `Inp_Sim.txt`
- `Orb_<case>.txt`
- `SC_<case>.txt`
- 若用户未要求时间脚本，则不默认生成复杂 `Inp_Cmd.txt`
