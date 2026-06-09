# 42 执行机构能力知识库

## 总览

当前主要执行机构模型在：

- `Source/42actuators.c`
- `Source/42joints.c`

原生最重要的执行机构包括：

- Reaction Wheel
- Magnetic Torquer Bar
- Thruster
- Joint actuator
- Ideal force / torque actuator

## 1. Reaction Wheel

模型位置：

- `42actuators.c::WhlModel()`

能力：

- 支持任意轮轴安装方向
- 支持 `Tmax`、`Hmax`、转动惯量 `J`
- 支持轮拖曳和轮抖动开关

构型支持：

- 三正交轮
- 金字塔四轮
- 任意自定义非共面构型

关键事实：

- 轮轴定义在所属 `Body` 坐标系中
- 输入文件使用 `Wheel Axis Components [X,Y,Z]`
- 初始化后会自动归一化

注意：

- 动力学本身支持任意构型
- 但当前自定义 CFS_FSW 的四轮零空间阻尼是按当前四轮构型写的，不具备完全通用性

## 2. Magnetic Torquer Bar

模型位置：

- `42actuators.c::MTBModel()`

能力：

- 支持任意单轴磁偶极矩器
- 给定 `Mcmd`，按 `T = M x B` 生成力矩
- 支持 `Mmax`

限制：

- 是否有效取决于当前环境磁场
- 地月等弱磁场任务通常不能照搬 LEO 磁控思路

## 3. Thruster

模型位置：

- `42actuators.c::ThrModel()`

能力：

- `PULSED`
- `PROPORTIONAL`
- 支持安装位置与方向
- 产生推力和附加力矩

适合：

- 轨控
- 姿控喷气
- 编队/交会推力控制

## 4. Joint actuator

模型位置：

- `42joints.c::ActuatedJoint()`

能力：

- 旋转关节速率控制
- 平移关节速率控制
- 支持最大角速度/位移速度、最大力矩/力

适合：

- 太阳翼单轴转动
- 天线指向
- 云台
- 展开机构

## 5. Passive Joint

模型位置：

- `42joints.c::PassiveJoint()`

能力：

- 弹簧阻尼型关节

适合：

- 被动展开
- 柔性铰链近似
- 简单释放机构

## 6. Ideal actuators

能力：

- `IdealFrc`
- `IdealTrq`

意义：

- 用于快速原型与概念验证
- 不需要真实硬件分配逻辑

适合早期：

- 交会/编队概念控制
- 先验证控制律，再替换为真实执行机构

## 7. 帆板展开相关能力

42 没有单独的“帆板展开模块”，但可以通过：

- 独立 `Body`
- `Joint`
- `PASSIVE` 或 `ACTUATED`

来建模帆板展开。

结论：

- 可以模拟展开过程
- 但复杂锁定、卡滞、限位等通常需要扩展 `AdHocJoint()`

## 8. 当前 CFS_FSW 中的执行机构使用

当前项目主要用到：

- 4 个飞轮
- 3 个磁力矩器
- 1 个太阳翼关节

接口文件：

- `Source/AcActuators.c`

其中：

- `WheelProcessing()` 做轮力矩分配
- `MtbProcessing()` 做磁力矩器分配
- `SolarArraySteering()` 负责当前太阳翼转动命令

## 9. AIGNC 工具要检查的点

对于任何执行机构需求，先判断：

1. 是原生支持，还是需要新建模型
2. 安装方向/位置是否可配置
3. 当前 FSW 是否已有命令接口
4. 是否需要额外的控制分配逻辑
