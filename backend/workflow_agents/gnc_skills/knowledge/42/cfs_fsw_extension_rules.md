# CFS_FSW 扩展规则知识库

## 1. 基本原则

所有 AI 自动改动默认遵守：

- 固定使用 `CFS_FSW`
- 优先在 workspace-local `ADCS` FSW 壳内完成需求
- 优先不改原生 42 真值模型
- 不把 sidecar 或 surrogate 能力误报为原生 42 支持

当前默认 FSW 根目录是：

- `<workspace>/FSW/ADCS/`
- `demo_server/open_codex_web/data/input_data/gnc/FSW/ADCS/` 作为新 case 模板

## 2. 默认安全修改区域

普通 `CFS_FSW` 实现优先修改：

- `ADCS/include/AcFswModules.h`
- `ADCS/src/AcSensors.c`
- `ADCS/src/AcMode.c`
- `ADCS/src/AcStateMachine.c`
- `ADCS/src/AcControl.c`
- `ADCS/src/AcActuators.c`

谨慎修改，但允许在明确需要接口适配时修改：

- `ADCS/src/42fsw.c`
- `ADCS/include/AcTypes.h`
- `ADCS/include/Ac.h`

默认不要把以下文件当作当前壳模块：

- `ADCS/src/AcApp.c`：当前壳实现不存在该文件

## 3. 各类需求的默认落点

### 新切模条件

默认修改：

- `ADCS/src/AcMode.c`
- 必要时配合 `ADCS/src/AcStateMachine.c`
- 阈值和模式 ID 放在 `ADCS/include/AcFswModules.h`

### 新应用层模式

默认修改：

- `ADCS/include/AcFswModules.h`：新增 mode ID、阈值、增益或状态字段
- `ADCS/src/AcMode.c`：新增模式名、切模条件、entry action
- `ADCS/src/AcControl.c`：新增模式控制分支
- `ADCS/src/AcStateMachine.c`：仅当主循环或模式状态结构需要变化时修改

### 新控制律

默认修改：

- `ADCS/src/AcControl.c`
- `ADCS/include/AcFswModules.h`

控制律应优先使用已有 `AcType` 字段，并输出到：

- `AC->Tcmd`
- `AC->Mcmd`
- `AC->Fcmd`
- `AC->IdealTrq`
- `AC->IdealFrc`

### 新传感器预处理

默认修改：

- `ADCS/src/AcSensors.c`
- 必要时修改 `ADCS/include/AcFswModules.h`
- 只有新增 `AcType` 字段时才修改 `ADCS/include/AcTypes.h`

允许实现：

- 已有传感器镜像字段的有效性判断
- 基于已有 `AC` 字段的滤波、坐标转换和 surrogate 测量
- mission-specific 派生量

不允许伪装实现：

- 新原生传感器物理模型
- 新 42 输入字段解析
- 新图像/光学真值输出

### 新执行机构分配逻辑

默认修改：

- `ADCS/src/AcActuators.c`
- 必要时修改 `ADCS/include/AcFswModules.h`

当前默认支持分配到：

- wheel torque
- MTB dipole
- thruster thrust level / pulse width
- ideal force / ideal torque passthrough

### 42 适配层或接口字段变化

只有当需求必须改变 `SCType <-> AcType` 映射时，才修改：

- `ADCS/src/42fsw.c`
- `ADCS/include/AcTypes.h`
- `ADCS/include/Ac.h`

这种修改必须检查：

- `InitAC()` 初始化是否完整
- `MapCmdsToActuators()` 是否写回 42 对象
- `ZeroAcCommands()` 是否清零新增命令
- 构建是否包含新增头文件或源文件

## 4. 什么情况不该只改 CFS_FSW

以下需求通常必须分类为 truth-model extension，而不是普通 FSW 改动。

### 新传感器真值模型

例如：

- 新相机
- 新地球敏感器原生模型
- 新视线测量器
- 新光学测距/测角真值模型
- 新传感器噪声、遮挡、视场或可见性物理

通常涉及：

- `codex_web/AIGNC/42/Include/42types.h`
- `codex_web/AIGNC/42/Source/42init.c`
- `codex_web/AIGNC/42/Source/42sensors.c`
- 相关 input parser 和 schema

### 新执行机构动力学

例如：

- 新型推进器动力学
- 新执行机构内部状态
- 新关节/机构物理模型
- FSM、光学载荷或 payload 作为原生 42 对象

通常涉及：

- `codex_web/AIGNC/42/Include/42types.h`
- `codex_web/AIGNC/42/Source/42init.c`
- `codex_web/AIGNC/42/Source/42actuators.c`
- `codex_web/AIGNC/42/Source/42joints.c`
- 相关 input parser 和 schema

### 新配置文件语义

如果需求需要新的 `Inp_Sim`、`SC_*`、sensor、actuator 或 joint 字段，不能只改 FSW。必须同步规划：

- 配置生成
- 配置验证
- 42 parser / schema
- 运行证据

## 5. sidecar 和 bridge 边界

`AcFswModules.h` 当前包含 `AcOpticalPayload.h`，说明项目可能存在 optical sidecar 编译路径。

规则是：

- 使用 sidecar 已有输出作为 FSW 输入，属于 `cross_boundary`
- 修改 `codex_web/AIGNC/bridge/mission_bypass` 需要用户明确批准
- sidecar 支持不等于原生 42 optical payload 支持
- 如果用户明确要求原生 42 payload object、parser 或 truth model，应分类为 truth-model extension

## 6. 推荐工作流

当用户输入新的 GNC/FSW 需求时，推荐按以下顺序处理：

1. 提取 FSW 需求：模式、切模条件、传感器契约、执行机构契约、性能指标
2. 判断每条需求属于：
   - `cfs_fsw_internal`
   - `cross_boundary`
   - `truth_model_extension`
3. 若是 `cfs_fsw_internal`：
   - 先定模式和状态字段
   - 再定传感器派生量
   - 再定控制律
   - 再定执行机构分配
   - 最后定验证输出
4. 若是 `cross_boundary`：
   - 明确 FSW 内部部分和 sidecar/adapter 部分
   - 不要直接修改 `codex_web/AIGNC/bridge/`，除非用户明确批准
5. 若是 `truth_model_extension`：
   - 不要在 FSW 中伪造支持
   - 明确列出需要修改的 42 真值模型和配置解析边界

## 7. 当前推荐模板

### 新姿态安全/阻尼逻辑

参考：

- `AC_MODE_SAFE`
- `AC_MODE_DETUMBLE`
- `AcSafeControl()`
- `AcDetumbleControl()`

### 新粗捕获逻辑

参考：

- `AC_MODE_ACQUIRE`
- `AcAcquireControl()`
- `AC->ES.Valid/Roll/Pitch`

### 新三轴跟踪逻辑

参考：

- `AC_MODE_TRACK`
- `AcTrackControl()`
- `AC->qbn`
- `AC->qln`
- `AC->wbn`
- `AC->wln`

### 新磁控或轮控分配

参考：

- `AcCommandTorque()`
- `WheelProcessing()`
- `MtbProcessing()`

### 新推力分配

参考：

- `AC->Fcmd`
- `ThrProcessing()`

### 简化焦平面/光学测量

若只是 FSW 消费已有 sidecar 输出，可作为 `cross_boundary` 规划。若要求原生 42 光学真值模型，应分类为 truth-model extension。

## 8. 验证要求

任何 `CFS_FSW` 扩展后，至少应做：

1. 编译通过：`python3 <workspace>/Script/build_42.py --headless`
2. 案例能运行：`python3 <workspace>/Script/run_case.py --headless`
3. 检查模式切换过程
4. 检查姿态、角速度和执行机构输出曲线
5. 与需求指标对比
6. 若涉及配置或真值模型，必须补充配置验证和运行证据
