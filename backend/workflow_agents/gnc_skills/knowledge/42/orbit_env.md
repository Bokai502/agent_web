# 42 轨道与环境能力知识库

## 1. 轨道传播层次

42 里“轨道”要分两层理解：

1. 参考轨道 `RefOrb`
2. 航天器相对参考轨道的传播方式 `Orbit Prop`

## 2. 航天器相对参考轨道传播方式

在 `SC_*.txt` 中主要有：

- `FIXED`
- `EULER_HILL`
- `ENCKE`
- `COWELL`

含义：

- `FIXED`
  - 固定在参考轨道上

- `EULER_HILL`
  - 线性相对运动模型

- `ENCKE`
  - 适合相对参考轨道偏差传播

- `COWELL`
  - 直接数值积分轨道状态

## 3. 参考轨道类型

`Orb_*.txt` 中主要支持：

- `CENTRAL`
- `THREE_BODY`
- `FLIGHT`
- `ZERO`

这使得 42 可以覆盖：

- 地球轨道
- 月球轨道
- 太阳系深空
- 小天体附近
- 地表/近表面运动

## 4. 多航天器能力

42 可以：

- 多航天器共享参考轨道
- 多航天器各自有独立参考轨道
- 同时仿真多星

适合：

- formation flying
- rendezvous
- proximity operations

## 5. 环境模型

当前全局环境在 `Inp_Sim.txt` 中可配置，包括：

- 磁场：`NONE / DIPOLE / IGRF`
- Earth/Mars/Luna gravity model degree/order
- Aerodynamic forces and torques
- Gravity gradient torques
- Solar pressure forces and torques
- Residual magnetic moment torques
- Gravity perturbation forces
- Thruster plume forces and torques
- Contact forces and torques
- CFD slosh forces and torques

## 6. 天体环境支持

42 支持：

- Earth
- Moon
- Mars
- 行星与主要卫星
- 小天体
- 三体系统

因此“能不能做绕月、绕火、彗星附近任务”的答案通常是：

- 动力学层支持
- 但传感器/执行机构和 FSW 不一定直接适配

## 7. 典型环境边界

### GPS
- 当前模型只适合地球轨道

### MTB
- 依赖有效磁场
- 对 LEO 有意义
- 对月球任务通常不适合直接用

### Aerodynamic
- 只在有大气环境时有意义

### SRP / gravity perturbation
- 深空和高轨任务中更重要

## 8. AIGNC 工具应优先核验的内容

给定任务场景，先判断：

1. 目标天体/轨道体制是否支持
2. 所选 `Orbit Prop` 是否合理
3. 环境模型是否有物理意义
4. 相关传感器/执行机构是否仍然适用
