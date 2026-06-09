# 42 传感器能力知识库

## 总览

当前 42 主传感器模型在：

- `Source/42sensors.c`

当前可用传感器主要包括：

- Accelerometer
- Gyro
- Magnetometer
- CSS
- FSS
- Star Tracker
- GPS
- FGS
- 简化 Earth Sensor
- Joint / Wheel telemetry

## 1. Gyro

模型位置：

- `42sensors.c::GyroModel()`

能力：

- 三轴或多轴速率测量
- 支持 sample time、最大量程、scale、量化、ARW、bias stability、噪声、bias

输出：

- 原始测量写入 `AC->Gyro[*].Rate`
- 在 `AcSensors` 处理中重构 `AC->wbn`

注意：

- 当前项目中曾修过一次陀螺计数溢出问题
- 若 `Ngyro == 0`，42 会直接给 FSW 真值角速度

## 2. Magnetometer

模型位置：

- `42sensors.c::MagnetometerModel()`

能力：

- 体轴磁场投影
- 支持 scale、饱和、量化、噪声

输出：

- 原始测量 `AC->MAG[*].Field`
- 处理后得到 `AC->bvb`

若缺省：

- `Nmag == 0` 时，42 会直接给真值磁场

## 3. CSS / FSS

### CSS
- `42sensors.c::CssModel()`
- 粗太阳敏感器
- 支持单轴法向定义、半锥角、量化、scale

### FSS
- `42sensors.c::FssModel()`
- 精太阳敏感器
- 支持完整安装姿态、视场、NEA、量化

输出：

- 太阳是否可见
- 太阳矢量或太阳角

若两者都缺省：

- 42 可直接给真值太阳矢量

## 4. Star Tracker

模型位置：

- `42sensors.c::StarTrackerModel()`

能力：

- 输出姿态四元数
- 支持安装姿态、视场、太阳/地球/月球遮挡角、角噪声

当前重要事实：

- 若 `Nst == 0`，42 当前会直接给 FSW 真值姿态四元数
- 所以“无星敏时姿态闭环是否真值”需要明确区分

## 5. GPS

模型位置：

- `42sensors.c::GpsModel()`

能力：

- 输出位置、速度、时间、经纬高

限制：

- 只适用于地球轨道场景
- 绕月、绕火等不直接支持这套 GPS 模型

## 6. Accelerometer

模型位置：

- `42sensors.c::AccelerometerModel()`

能力：

- 加速度测量
- 考虑传感器安装位置、姿态变化和重力梯度影响

## 7. FGS

模型位置：

- `42sensors.c::SimpleFgsModel()`
- `42sensors.c::FullFgsModel()`

能力：

- 更像精跟踪视线偏差传感器，而不是完整成像相机
- `Simple` 版直接输出视场偏差
- `Full` 版可走光学链

适用判断：

- 适合作为“简化焦平面目标偏差传感器”的模板
- 不等价于完整二维图像相机

## 8. 简化 Earth Sensor

不是完整独立传感器类，更像在 `Sensors()` 里直接计算的简化地球指向量。

适合作为：

- 简化地平/地球方向可见性参考

不适合直接当高保真地球敏感器使用。

## 9. 当前 CFS_FSW 中的传感器使用方式

当前 `CFS_FSW -> AcFsw()` 里，传感器处理是：

- `AcSensors.c`

作用是：

- 测量重构
- 简单预处理

不是：

- 完整融合估计器
- EKF / MEKF / UKF

## 10. AIGNC 需要特别检查的点

在从任务文档生成场景时，必须先判断：

1. 这类传感器是否原生存在
2. 是真测量还是缺省真值注入
3. 当前 FSW 是否已经有读取接口
4. 是否需要新增传感器模型或只需新增 FSW 处理
