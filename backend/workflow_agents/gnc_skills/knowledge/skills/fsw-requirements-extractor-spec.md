# Skill Spec: fsw-requirements-extractor

## 1. 目标

从用户自然语言任务描述或任务文档中，抽取与当前固定 `CFS_FSW` 实现有关的 FSW/GNC 需求，并形成后续代码实现可用的规格。

这个 skill 负责：

- 抽取完整 GNC 飞控模式序列
- 抽取模式切换过程和切换条件
- 抽取每个模式的传感器、执行器和控制方法要求
- 抽取每个模式的控制目标、指向导引率、目标姿态和目标坐标系
- 抽取每个模式的通过性/完成判据
- 明确哪些内容是需求，哪些内容是 AI 推断或待确认假设

它不负责：

- 直接修改代码
- 直接决定 42 真模型扩展

## 2. 触发条件

当用户需求明确包含以下任意一类时触发：

- 控制模式
- 姿态目标
- 轨控/姿控方法
- 切模条件
- 传感器处理/估计要求
- 执行机构分配要求

## 3. 输入

### 必要输入

- 用户自然语言任务描述
  或
- 任务文档

### 推荐辅助输入

- `scenario_facts.json`
- `capability_assessment.json`

## 4. 输出

### 4.1 人类可读规格

`fsw_requirement_spec.md`

建议结构：

1. 完整 GNC 过程总览和有序模式序列
2. 模式切换过程及切换条件，包括正常切换、回退/安全切换、超时和未决假设
3. 每个模式对应的传感器配置、执行器配置和可能采取或必须采取的控制方法
4. 每个模式对应的控制目标、指向导引率、目标姿态、目标坐标系和目标矢量/视线
5. 每个模式的通过性/完成判据，包括阈值、保持时间、有效性窗口和判据证据
6. 超出当前固定 `CFS_FSW` 能力的需求
7. 仍需确认的问题

### 4.2 模式表

`mode_table.json`

建议字段：

```json
[
  {
    "mode_id": "",
    "mode_name": "",
    "purpose": "",
    "mode_sequence_index": 0,
    "entry_conditions": [],
    "exit_conditions": [],
    "fallback_or_fault_transitions": [],
    "required_sensors": [],
    "optional_or_fallback_sensors": [],
    "required_actuators": [],
    "inhibited_actuators": [],
    "control_method": "",
    "control_target": "",
    "guidance_rate": "",
    "target_frame": "",
    "target_attitude": "",
    "target_vector_or_los": "",
    "command_outputs": [],
    "pass_criteria": [],
    "unresolved_questions": []
  }
]
```

### 4.3 接口约束

`sensor_actuator_contract.json`

建议字段：

```json
{
  "mode_sensor_actuator_matrix": [],
  "required_sensor_inputs": [],
  "sensor_validity_requirements": [],
  "estimation_or_truth_state_assumptions": [],
  "required_actuator_outputs": [],
  "actuator_enable_inhibit_rules": [],
  "allocation_requirements": [],
  "saturation_and_fault_handling": [],
  "mode_specific_control_methods": [],
  "mode_specific_pass_criteria": [],
  "open_interface_questions": []
}
```

## 5. 读取哪些知识库

### 主层默认读取

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

### 结构化索引默认读取

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_architecture.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_extension_rules.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`

### 按需读取 details

仅当用户要求非常具体的接口细节时，按需读取：

- 相关 sensor schema
- 相关 actuator schema

## 6. 工作流

### Step 1. 抽取控制语义

先识别：

- 是姿态控制、轨控，还是两者都有
- 是单模式还是多模式
- 完整模式序列从初始/安全状态到任务终态如何推进
- 每个模式的目标对象是什么
  - sun
  - LVLH
  - target LOS
  - angular-rate reduction
- 每个模式的导引率、目标姿态、目标坐标系、目标矢量或视线是什么
- 每个模式使用哪些传感器、执行器和控制方法
- 每个模式如何判定通过或完成

### Step 2. 抽取切模逻辑和通过性判据

把自然语言切模条件和模式通过性判据转成结构化条件，但不直接翻译成 C 代码。每个模式都必须有入口条件、退出条件、回退/安全条件和完成/通过判据；如果输入无法确定，必须写入 unresolved questions。

例如：

- 角速度阈值
- 姿态误差阈值
- 指向矢量/视线误差阈值
- 导引率或跟踪残差阈值
- 轮动量阈值
- 传感器有效性
- 时间保持条件
- 超时、故障或安全回退条件

### Step 3. 抽取控制实现约束

对每个模式分别抽取，例如：

- 必须使用四元数误差还是可用欧拉角
- 是否要求前馈项、速率阻尼、姿态保持、目标跟踪或 LVLH 指向
- 是否要求动量管理或卸载
- 传感器有效性门限和回退传感器
- 执行器使能/禁止状态、分配规则、饱和处理
- 是否允许真值姿态闭环或必须基于测量/估计量

### Step 4. 识别是否超出当前 `CFS_FSW`

若需求包含：

- 新真传感器模型
- 新执行机构模型
- 完整导航融合栈

则必须在输出中明确标记，不可假装它只是控制律修改。

## 7. 必须停止并提问的条件

1. “对地 / 对月 / 对目标”存在多种物理含义
2. 用户没有说明切模依据但模式链依赖它
3. 某个模式缺少控制目标、导引率、目标姿态、目标坐标系或通过性判据
4. 用户要求控制算法，但没有说明可用传感器/执行机构
5. 用户把估计需求和真值闭环要求混在一起

## 8. 不允许做的事情

- 不直接生成 `AcControl.c` 代码
- 不直接决定真实传感器/执行机构扩展方案
- 不把模糊的任务语义直接固化成代码级条件

## 9. 成功标准

1. 下游 `fsw-architecture-planner` 能基于这份规格决定改哪些文件
2. 模式、切模条件、接口约束、控制目标、导引率、目标姿态和通过性判据都被结构化
3. 模糊处没有被静默假设为“理所当然”

## 10. 最小示例

输入：

> 入轨后先磁控消旋，三轴角速度都小于 0.2 deg/s 后进入对日模式，对日时 -Y 轴对日；稳定后切到 LVLH 三轴稳定；轮动量超过 80% 时允许卸载。

输出重点：

- 3 个模式：
  - `DETUMBLE`
  - `SUN_POINT`
  - `EARTH_POINT`（若不要求捕获过渡，可不单列 `EARTH_ACQ`）
- 切模条件结构化
- 主要传感器：
  - gyro / magnetometer / sun sensor / orbit state
- 主要执行机构：
  - MTB / wheel
