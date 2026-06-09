# CFS_FSW 接口知识库

## 1. 接口对象

当前 workspace-local `CFS_FSW` 的核心接口对象是：

- `struct AcType`

它是 42 真值仿真侧与 FSW 应用层之间的飞控镜像。关系是：

- `struct SCType` 是 42 的整星真模型对象
- `SCType.AC` 是该星暴露给 workspace-local FSW 的 `AcType` 接口对象
- `ADCS/src/42fsw.c::InitAC()` 从 `SCType` 初始化 `AcType`
- `ADCS/src/42fsw.c::MapCmdsToActuators()` 将 `AcType` 命令写回 42 执行机构对象

FSW 模式、传感器处理、控制律和执行机构分配应优先操作 `struct AcType`，不要在这些模块中直接修改 `struct SCType`。

## 2. 适配层接口

`ADCS/src/42fsw.c` 是唯一默认允许接触 `SCType` 的 FSW 适配层。它负责：

- `FswCmdInterpreter()`：解析 `FswTag` 命令
- `InitAC()`：复制 spacecraft ID、质量、质心、惯量、body、joint、传感器和执行机构配置到 `AC`
- `FlightSoftWare()`：按 FSW sample cadence 调用 `CFS_FSW`
- `CfsFSW()`：调用 `AcFsw(AC)`
- `MapCmdsToActuators()`：将 `AC` 命令复制回 ideal actuator、wheel、MTB 和 thruster

普通控制逻辑应放在 `AcSensors.c`、`AcMode.c`、`AcStateMachine.c`、`AcControl.c`、`AcActuators.c` 中。

## 3. 主要输入接口

当前壳实现可以读取的主要 `AcType` 输入包括：

### 基本状态

- `AC->ID`
- `AC->DT`
- `AC->mass`
- `AC->cm[3]`
- `AC->MOI[3][3]`
- `AC->Nb`
- `AC->Ng`

### 姿态、角速度和参考状态

- `AC->qbn[4]`
- `AC->wbn[3]`
- `AC->PosN[3]`
- `AC->VelN[3]`
- `AC->svn[3]`
- `AC->svb[3]`
- `AC->bvn[3]`
- `AC->bvb[3]`
- `AC->Hvb[3]`

### 传感器镜像

- `AC->Gyro[*].Rate`
- `AC->MAG[*].Field`
- `AC->CSS[*].Valid`
- `AC->CSS[*].Illum`
- `AC->FSS[*].Valid`
- `AC->FSS[*].SunAng[2]`
- `AC->ST[*].Valid`
- `AC->ST[*].qn[4]`
- `AC->GPS[*].Valid`
- `AC->GPS[*].PosN[3]`
- `AC->GPS[*].VelN[3]`
- `AC->Accel[*].Acc`

### 执行机构状态和配置

- `AC->Whl[*].Axis[3]`
- `AC->Whl[*].DistVec[3]`
- `AC->Whl[*].Tmax`
- `AC->Whl[*].Hmax`
- `AC->Whl[*].H`
- `AC->MTB[*].Axis[3]`
- `AC->MTB[*].DistVec[3]`
- `AC->MTB[*].Mmax`
- `AC->Thr[*].Axis[3]`
- `AC->Thr[*].Fmax`

### 关节镜像

- `AC->G[*].Ang[3]`
- `AC->G[*].AngRate[3]`
- `AC->G[*].Pos[3]`
- `AC->G[*].PosRate[3]`

当前壳实现不会默认向 joint command 写命令。需要关节控制时，必须先在架构规划中明确 `AcActuators.c`、`AcTypes.h` 和 42 joint 真值边界。

## 4. 派生状态接口

`ADCS/src/AcSensors.c` 当前会维护以下派生状态：

- `AC->CBN[3][3]`：由 `qbn` 派生
- `AC->CLN[3][3]`：由 `PosN/VelN` 派生的 LVLH frame
- `AC->qln[4]`：由 `CLN` 派生
- `AC->wln[3]`：由 `FindCLN()` 派生
- `AC->EphValid`：由非零 `PosN/VelN` 判断
- `AC->ES.Valid`
- `AC->ES.Roll`
- `AC->ES.Pitch`

这些是 FSW 内部可用的参考状态和 surrogate 测量，不代表 42 已经实现了独立 Earth sensor 真值模型。

## 5. 有效性标志

当前模式逻辑主要使用：

- `AC->SunValid`
- `AC->MagValid`
- `AC->StValid`
- `AC->EphValid`
- `AC->ES.Valid`

`AcDetermineMode()` 会把它们整理到 `struct AcModeStateType`：

- `State->SunValid`
- `State->MagValid`
- `State->StValid`
- `State->NavValid`
- `State->AttValid`
- `State->RateMag`

## 6. 主要输出接口

当前 `CFS_FSW` 最终写出的主要命令包括：

### 体级命令

- `AC->Tcmd[3]`
- `AC->Mcmd[3]`
- `AC->Fcmd[3]`
- `AC->IdealTrq[3]`
- `AC->IdealFrc[3]`

### 模式状态

- `AC->Mode`

### 执行机构命令

- `AC->Whl[*].Tcmd`
- `AC->MTB[*].Mcmd`
- `AC->Thr[*].Fcmd`
- `AC->Thr[*].ThrustLevelCmd`
- `AC->Thr[*].PulseWidthCmd`

这些命令由 `MapCmdsToActuators()` 复制到 42 的：

- `S->IdealAct[*].Tcmd/Fcmd`
- `S->Whl[*].Tcmd`
- `S->MTB[*].Mcmd`
- `S->Thr[*].ThrustLevelCmd`
- `S->Thr[*].PulseWidthCmd`

## 7. 控制器内部状态

当前壳实现主要使用：

- `AC->CfsCtrl.Init`
- `AC->qbr[4]`
- `struct AcModeStateType`
  - `Mode`
  - `PrevMode`
  - `NextMode`
  - `ModeChanged`
  - `ModeTime`
  - `FswTime`
  - `RateMag`
  - validity flags

`AcTypes.h` 中还保留 `InstantCtrl`、`ThreeAxisCtrl`、`ThrCtrl` 等历史控制器状态结构，但当前壳的默认控制调度不直接依赖它们。不要把这些历史结构误认为当前默认控制链已经实现。

## 8. 当前接口边界的关键事实

- `AcSensors.c` 中多个传感器处理函数当前是占位函数，允许后续基于已有 `AcType` 字段补充预处理。
- `EphValid/CLN/qln/wln` 当前来自 `PosN/VelN` 派生，不等价于完整导航滤波器。
- `ES` 是 coarse Earth-sensor surrogate，不等价于独立原生 42 Earth sensor 模型。
- 当前执行机构分配支持 wheel、MTB、thruster 和 ideal actuator 命令通道。
- 当前默认壳不实现 joint command dispatch；涉及 joint 的需求要单独规划。
- optical payload sidecar 头文件可能进入编译边界，但这不代表原生 42 已支持 optical payload 真值模型。

## 9. AI 实现接口规则

1. 控制律、模式和传感器预处理优先只读写 `AcType`。
2. 直接读写 `SCType` 的改动默认只允许在 `ADCS/src/42fsw.c` 适配层。
3. 体级姿态控制优先写 `Tcmd/Mcmd/IdealTrq`。
4. 平动或推力相关控制优先写 `Fcmd/IdealFrc`，再由 `AcActuators.c` 分配到 thruster。
5. 执行机构最终输出由 `AcDispatchActuators()` 和 `MapCmdsToActuators()` 完成。
6. 新增接口字段时必须同步检查 `AcTypes.h`、初始化、清零、执行机构映射、输出记录和构建依赖。
7. 需要新真值测量或新物理执行机构时，不应伪装成普通 `CFS_FSW` 接口改动。
