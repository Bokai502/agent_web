# CFS_FSW 架构知识库

## 1. 固定前提

本项目的 AIGNC 工作流默认使用 workspace-local 的固定飞控框架：

- `FswTag = CFS_FSW`
- FSW 源码位于 `<workspace>/FSW/ADCS/` 或新模板 `open_codex_web/data/input_data/gnc/00_inputs/FSW/ADCS/`
- 原生 42 真值仿真仍由 `codex_web/AIGNC/42/` 和运行目录中的 42 仿真器负责

AI 不需要再在 42 内置 FSW 类型之间选择，例如：

- `THREE_AXIS_FSW`
- `THR_FSW`
- `SPINNER_FSW`

AI 只需要判断需求能否在当前 `CFS_FSW` 壳实现内完成，或者是否已经越界到 42 真值模型扩展。

## 2. 顶层调用链

当前 workspace-local 主调用链是：

```text
ADCS/src/42fsw.c::FlightSoftWare(struct SCType *S)
 -> if S->FswTag == CFS_FSW
 -> ADCS/src/42fsw.c::CfsFSW(&S->AC)
 -> ADCS/src/AcStateMachine.c::AcFsw(struct AcType *AC)
```

`ADCS/src/42fsw.c` 也是 42 与 `AcType` 飞控镜像之间的适配层，负责：

- `FswCmdInterpreter()`：解析 `FswTag` 命令
- `InitAC()`：从 `SCType` 初始化 `AcType`
- `FlightSoftWare()`：按 `FswSampleCounter/FswMaxCounter` 调用 `CFS_FSW`
- `MapCmdsToActuators()`：把 `AC` 命令映射回 42 执行机构对象

控制律和模式逻辑应操作 `struct AcType`。直接访问 `struct SCType` 的逻辑应限制在 `ADCS/src/42fsw.c` 适配层。

## 3. 当前 FSW 文件边界

当前壳实现包含：

- `ADCS/include/Ac.h`
  - 引入 `AcTypes.h` 和 42 kit 头文件
  - 声明 `AcFsw(struct AcType *AC)`
  - 保留 workspace-local FSW 的公共入口

- `ADCS/include/AcTypes.h`
  - 定义 `struct AcType`
  - 定义传感器镜像结构：gyro、magnetometer、CSS、FSS、star tracker、GPS、accelerometer、coarse Earth sensor surrogate
  - 定义执行机构镜像结构：wheel、MTB、thruster
  - 保留若干历史控制器状态结构，但当前壳实现主要使用 `AcCfsCtrlType` 初始化标志和模板命令字段

- `ADCS/include/AcFswModules.h`
  - 定义模板模式 ID、默认阈值、默认控制增益
  - 定义 `struct AcModeStateType`
  - 声明传感器、模式、控制、执行机构和 `AcFsw()` 模块接口
  - 当前包含 `AcOpticalPayload.h`，用于保留 optical sidecar 编译边界；普通 FSW 需求不得因此假定原生 42 已有光学载荷真值模型

- `ADCS/src/42fsw.c`
  - workspace-local 42 适配器
  - 初始化 `AC` 镜像、传感器/执行机构数组和默认控制器 Init 标志
  - 调用 `CfsFSW()` / `AcFsw()`
  - 将 `AC->IdealTrq/IdealFrc`、wheel、MTB、thruster 命令复制回 42 对象

- `ADCS/src/AcSensors.c`
  - 当前是传感器同步壳
  - `AcSyncReferenceState()` 从已有 `AC` 字段重构 `CBN`、`CLN`、`qln`、`wln`、`EphValid`
  - 提供基于位置矢量的 coarse Earth-sensor surrogate：`AC->ES.Valid/Roll/Pitch`
  - `GyroProcessing()`、`MagnetometerProcessing()`、`CssProcessing()`、`FssProcessing()`、`StarTrackerProcessing()`、`GpsProcessing()`、`AccelProcessing()` 当前是可编译占位函数

- `ADCS/src/AcMode.c`
  - 定义模式名
  - `AcDetermineMode()` 实现模板切模逻辑
  - `AcOnModeEntry()` 是模式进入动作占位点

- `ADCS/src/AcStateMachine.c`
  - 提供 `AcFsw()` 每拍主流程
  - 每个 spacecraft 使用静态 `AcModeStateType State[AC_MAX_STATE_SC]` 保存状态
  - 初始化时进入 `SAFE`
  - 每拍顺序为传感器处理、清命令、切模、模式进入、控制、执行机构分配

- `ADCS/src/AcControl.c`
  - `ZeroAcCommands()` 清空力/力矩/理想执行机构命令
  - 当前提供四个模板控制分支：quiet safe、rate detumble、coarse acquire、LVLH track
  - 当前力矩命令走 `AcCommandTorque()`，同时支持 ideal torque、wheel torque vector 和磁力矩器 dipole vector

- `ADCS/src/AcActuators.c`
  - `WheelProcessing()`：将 `AC->Tcmd` 按 wheel `DistVec` 分配为 `Whl[i].Tcmd`
  - `MtbProcessing()`：将 `AC->Mcmd` 按 MTB `DistVec` 分配为 `MTB[i].Mcmd`
  - `ThrProcessing()`：将 `AC->Fcmd` 投影到 thruster 轴向，生成 `ThrustLevelCmd` 和 `PulseWidthCmd`
  - `AcDispatchActuators()` 调用上述三个分配通道

当前壳实现没有 `ADCS/src/AcApp.c`。不要再把 standalone `AcApp.c` 作为默认模块边界。

## 4. 当前 FSW 周期

`AcFsw()` 的每拍顺序是：

1. 首次进入时用 `AC->CfsCtrl.Init` 初始化 per-spacecraft 状态
2. `AcProcessSensors(AC)`
3. `ZeroAcCommands(AC)`
4. `AcDetermineMode(AC,&State[Idx])`
5. 若 `NextMode != Mode`，更新 `PrevMode/Mode/ModeTime` 并调用 `AcOnModeEntry()`
6. `AcApplyControl(AC,State[Idx].Mode,State[Idx].ModeTime)`
7. 更新 `State[Idx].FswTime` 和 `AC->Mode`
8. `AcDispatchActuators(AC,AC->Mode)`

随后 `42fsw.c::MapCmdsToActuators()` 将 `AC` 输出复制到 42 执行机构对象。

## 5. 当前内部模式

当前 `CFS_FSW` 壳定义四个应用层模式：

- `AC_MODE_SAFE`
  - 模式名 `SAFE`
  - 安静保持，默认不输出命令

- `AC_MODE_DETUMBLE`
  - 模式名 `DETUMBLE`
  - 按 `-AC_DETUMBLE_GAIN*wbn` 生成阻尼力矩

- `AC_MODE_ACQUIRE`
  - 模式名 `ACQUIRE`
  - 角速度阻尼加 coarse Earth-sensor roll/pitch 反馈

- `AC_MODE_TRACK`
  - 模式名 `TRACK`
  - 使用 `qbn/qln` 和 `wbn/wln` 做简单 LVLH 三轴 PD 跟踪

默认切模序列是：

```text
SAFE -> DETUMBLE -> ACQUIRE -> TRACK
```

`ACQUIRE` 或 `TRACK` 在姿态无效或角速度超限时回退到 `DETUMBLE`。

这些模式只是 `CFS_FSW` 应用层内部模式，不是 42 顶层 `FswTag` 类型。

## 6. 传感器与参考状态边界

当前壳实现依赖 42 已经写入 `AC` 的标准状态和传感器字段。它可以在 `AcSensors.c` 内做：

- 姿态 DCM 和四元数派生
- LVLH 参考 `CLN/qln/wln` 派生
- `EphValid` 等有效性标志整理
- 粗略 Earth sensor surrogate
- mission-specific 传感器预处理或滤波占位实现

它不能仅通过 FSW 代码新增 42 原生传感器真值模型。若需求需要新的传感器物理、解析字段、噪声模型或图像/光学真值输出，应分类为 truth-model extension。

## 7. 控制与执行机构边界

当前壳实现支持在 `AcControl.c` 中生成：

- `AC->IdealTrq[3]`
- `AC->IdealFrc[3]`
- `AC->Tcmd[3]`
- `AC->Mcmd[3]`
- `AC->Fcmd[3]`

当前壳实现支持在 `AcActuators.c` 中分配到：

- reaction wheel torque command
- magnetic torquer dipole command
- simple positive thruster level / pulse-width command
- ideal force / ideal torque passthrough

它可以修改控制律、模式策略、命令限幅和已有执行机构分配策略。

它不能仅通过 FSW 代码新增原生执行机构动力学、机构约束、关节动力学或 42 输入文件解析规则。这类需求必须进入 42 真值模型或配置生成阶段。

## 8. AIGNC 工具在这层的作用

AIGNC 在 `CFS_FSW` 架构层面主要做三类判断：

1. 需求能否完全落在 `ADCS/src/AcSensors.c`、`AcMode.c`、`AcStateMachine.c`、`AcControl.c`、`AcActuators.c` 和 `ADCS/include/AcFswModules.h`
2. 需求是否只需要使用 `AC` 已有字段和 42 已有传感器/执行机构镜像
3. 需求是否越界到原生 42 真值模型、配置解析、sidecar bridge 或外部 payload 模型

## 9. 建议修改边界

### 可在当前 `CFS_FSW` 壳内实现

- 改切模条件、模式顺序和 fallback 条件
- 改默认阈值和控制增益
- 新增应用层模式枚举和模式进入动作
- 新增或替换 `AcApplyControl()` 下的控制分支
- 新增基于现有 `AC` 字段的传感器预处理、有效性判断或滤波
- 修改 wheel、MTB、thruster、ideal actuator 分配策略
- 新增报告/跟踪所需的 `AC` 内部状态，但需要同步更新头文件和构建依赖

### 超出当前 `CFS_FSW` 壳

- 新传感器真值模型
- 新执行机构动力学模型
- 新图像相机或光学测量真值模型
- 新机构/关节动力学
- 新 42 输入文件字段解析
- 需要修改 `codex_web/AIGNC/42/Include/42types.h`、`codex_web/AIGNC/42/Source/42init.c`、`codex_web/AIGNC/42/Source/42sensors.c`、`codex_web/AIGNC/42/Source/42actuators.c` 或 `codex_web/AIGNC/42/Source/42joints.c` 的能力

这些必须进入 truth-model extension 或 codex_web/AIGNC/bridge/mission_bypass 专项规划，不能在普通 `fsw-code-author` 阶段静默实现。
