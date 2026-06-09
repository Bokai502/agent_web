# 42 能力知识库总览

这是一份面向 AIGNC 工具的 42 能力知识库第一版。目标不是覆盖 42 的所有细节，而是回答下面这几个产品问题：

1. 用户提出的任务，42 当前能不能做。
2. 能做的话，落到哪些输入文件、哪些模型、哪些 FSW 入口。
3. 不能直接做的话，是近似支持，还是必须扩展代码。

## 42 的产品定位

42 是一个多航天器、通用姿态与轨道动力学仿真器。核心能力包括：

- 多刚体/柔性体姿态动力学
- 中心天体、三体、表面等多种轨道/运动环境
- 可配置的传感器与执行机构模型
- 内置 FSW 模式，以及可扩展的 `CFS_FSW -> AcFsw()` 应用层
- 文本输入配置、文本输出、OpenGL 图形前端

## AIGNC 工具最相关的 5 个问题

### 1. 输入配置怎么组织
对应：

- `Inp_Sim.txt`
- `Orb_*.txt`
- `SC_*.txt`
- `Inp_Cmd.txt`
- `Inp_*Output.txt`

### 2. 传感器是否原生支持
典型问题：

- 是否有陀螺、星敏、GPS、FGS、磁强计、太阳敏感器
- 若没有某类传感器，42 是否会直接给真值

### 3. 执行机构是否原生支持
典型问题：

- 飞轮是否支持任意安装构型
- 是否有磁力矩器、推进器、关节
- 是否能做帆板展开

### 4. FSW 应该落在哪
当前最重要的是：

- `42fsw.c::FlightSoftWare()`
- `CFS_FSW`
- `AcFsw()` 及其模块化实现

### 5. 当前能力边界在哪里
典型问题：

- 月球轨道是否支持 GPS
- 是否有高保真 docking/capture
- FGS 是否等价于成像相机
- 当前四轮动量管理是否写死某种构型

## 推荐使用方式

### 面向人
优先读：

1. `inputs.md`
2. `sensors.md`
3. `actuators.md`
4. `cfs_fsw_architecture.md`
5. `cfs_fsw_interfaces.md`
6. `cfs_fsw_extension_rules.md`
7. `limitations.md`

### 面向 skill
优先查：

- `capabilities/inputs.json`
- `capabilities/sensors.json`
- `capabilities/actuators.json`
- `capabilities/cfs_fsw_architecture.json`
- `capabilities/cfs_fsw_interfaces.json`
- `capabilities/cfs_fsw_extension_rules.json`
- `capabilities/orbit_env.json`
- `capabilities/limitations.json`

若需要更细字段级规则，再按需进入：

- `details/inputs/*.schema.json`
- `details/sensors/*.schema.json`
- `details/actuators/*.schema.json`
- `details/notes/*.md`

当前推荐按需优先加载：

- `details/inputs/inp_sim.schema.json`
- `details/inputs/sc.schema.json`
- `details/actuators/wheel.schema.json`
- `details/sensors/gyro.schema.json`
- `details/sensors/gps.schema.json`

## 当前版本范围

当前知识库当前版本重点覆盖：

- 42 输入文件架构
- 传感器/执行机构原生能力
- 当前 `CFS_FSW` 模块化实现与接口
- 常见轨道与环境能力边界
- 现有 Demo 与截图映射

后续应继续补充：

- 更细的配置字段映射
- 输入字段与结构体成员映射
- 传感器/执行机构扩展模板
- 结果诊断规则库
