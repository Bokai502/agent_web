# 42 示例与截图映射知识库

## 1. Demo 目录定位

`Demo/` 目录主要是官方演示案例集合，不是按任务类型严格分类的“产品模板库”。

但它对于 AIGNC 有两个用途：

1. 提供已知可运行样例
2. 提供“任务 -> 配置文件”映射模板

## 2. 典型 Demo

### ISS + Shuttle
对应：

- `Demo/Inp_Sim.txt`
- `Demo/SC_ISS.txt`
- `Demo/SC_Shuttle.txt`
- `Demo/Orb_ISS.txt`

适合映射：

- rendezvous
- proximity operations
- formation / relative motion demo

### 67P / IonCruiser
对应：

- `Demo/Orb_67P.txt`
- `Demo/SC_IonCruiser.txt`

适合映射：

- 小天体附近任务
- 深空概念任务

### Hexapod on Mars
对应：

- `Demo/Orb_Hexapod.txt`
- `Demo/SC_Hexapod.txt`

适合映射：

- 行星表面机构任务
- 多关节运动系统

### Aura
对应：

- `Demo/SC_Aura.txt`

适合映射：

- 三轴姿态控制
- 轮 + MTB + 太阳翼关节

## 3. 42 Summary for DSM 最后一页截图映射

### Fermi Gamma-ray sky
结论：

- 有图形资源
- 没有完整卫星任务 Demo

### Conceptual rendezvous and capture scenario
结论：

- 没有同名独立 Demo
- 最接近 ISS + Shuttle 案例

### Conceptual spacecraft in orbit about Comet 67P-CG
结论：

- 有直接对应 Demo

### Conceptual hexapod rover on the surface of Mars
结论：

- 有直接对应 Demo

## 4. AIGNC 工具如何使用 examples

主要用途不是直接复制，而是：

1. 找最接近的模板
2. 决定应参考哪些输入文件
3. 判断用户需求是否偏离 42 现有示例太多

如果偏离太多，应优先触发：

- 能力核验
- 交互澄清
- 扩展点建议
