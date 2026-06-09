# 42 输入配置知识库

## 输入体系总览

42 的案例通常由以下几类输入组成：

- 全局仿真控制：`Inp_Sim.txt`
- 轨道定义：`Orb_*.txt`
- 航天器定义：`SC_*.txt`
- 命令脚本：`Inp_Cmd.txt`
- 输出控制：`Inp_AcOutput.txt`、`Inp_ScOutput.txt` 等
- 图形与通信：`Inp_Graphics.txt`、`Inp_IPC.txt`、`Inp_CommLink.txt`

## 1. Inp_Sim.txt

作用：

- 定义仿真时长、步长、是否启用 GUI
- 绑定参考轨道文件
- 绑定航天器文件
- 定义环境模型总开关
- 定义关心的天体与地面站

典型关键字段：

- `Time Mode`
- `Sim Duration, Step Size`
- `Graphics Front End?`
- `Number of Reference Orbits`
- `Reference Orbit File List`
- `Number of Spacecraft`
- `Spacecraft Exists / RefOrb / SC File`
- `Magfield`
- `Gravity Model`
- `Aerodynamic / SRP / Gravity Perturbation / Contact / Slosh`

## 2. Orb_*.txt

作用：

- 定义一条参考轨道
- 参考轨道可被一个或多个航天器引用

支持的主要轨道类型：

- `ZERO`
- `FLIGHT`
- `CENTRAL`
- `THREE_BODY`

中央体轨道常见输入：

- 中心天体
- 是否考虑 J2 secular drift
- `KEP` / `RV` / `FILE`
- `PA` / `AE`
- 倾角、RAAN、近地点幅角、真近点角

还定义：

- `Formation Frame`
- `Formation Origin`

这决定了 `FRM` 坐标系的含义。

## 3. SC_*.txt

作用：

- 定义单个航天器的动力学、执行机构、传感器、FSW 标签

主要内容块：

1. 基本信息
2. `Flight Software Identifier`
3. `Orbit Prop`
4. 初始姿态
5. Dynamics flags
6. Body parameters
7. Joint parameters
8. Wheel parameters
9. MTB parameters
10. Thruster parameters
11. Sensor sections

关键说明：

- `Orbit Prop` 决定航天器相对参考轨道的传播方式：
  - `FIXED`
  - `EULER_HILL`
  - `ENCKE`
  - `COWELL`

## 4. Inp_Cmd.txt

作用：

- 命令脚本
- 可按时间向仿真或 FSW 注入命令
- 更适合内置 FSW、GUI 视角、脚本演示

当前如果走你自定义的 `CFS_FSW` 状态机，很多模式切换不再依赖 `Inp_Cmd.txt`，而依赖控制逻辑自身条件。

## 5. 输出控制文件

常用有：

- `Inp_AcOutput.txt`
- `Inp_ScOutput.txt`

作用：

- 控制哪些遥测文件输出
- 控制输出周期
- 用于调试 FSW、动力学、执行机构状态

## 6. 图形与 IPC 配置

- `Inp_Graphics.txt`
  - 图形视角、FOV、显示层、目标对象

- `Inp_IPC.txt`
  - 外部通信方式
  - `TX / RX / TXRX / READFILE / WRITEFILE`

## 7. AIGNC 工具映射建议

从自然语言生成 42 配置时，可按下面的顺序映射：

1. 场景级参数 -> `Inp_Sim.txt`
2. 轨道环境 -> `Orb_*.txt`
3. 平台参数 -> `SC_*.txt`
4. 操作命令/演示脚本 -> `Inp_Cmd.txt`
5. 验证需求 -> `Inp_*Output.txt`

## 8. 当前已整理资源

可结合已有文档：

- `Docs/42_InOut_Parameter_Catalog.md`

这份文档更偏参数目录；本文件更偏产品级“输入架构说明”。
