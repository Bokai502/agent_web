# 热仿真数据库 Headers

数据源：`/data/wqn/cad2comsol2paraview/data/module_db/热仿真数据库.xlsx`

JSON 文件：`references/热仿真数据库.json`

Sheet：`Sheet1`

该文件说明热仿真数据库中的字段。查询组件信息前，先根据任务需求选择相关字段，再去 JSON 中查找对应记录。

## 字段列表

| Header | 参考含义 / 映射 |
| --- | --- |
| 器件型号 | model |
| 器件名称 | name |
| 器件名称(中文) | name_cn |
| 外形 | shape |
| 描述 / 用途说明） | description |
| 尺寸 | dimensions |
| 长 mm | length |
| 宽 mm | width |
| 高 mm | height |
| 质量 g | mass |
| 核心材料 | material |
| 安装面 | mounting face |
| CAD路径 | cad_path |
| 导热率W/(m·K) | thermal_conductivity |
| 辐射率 | emissivity |
| 热阻K/W | thermal_resistance |
| 接触热阻K/W | contact_resistance |
| 比热容J/(kg·K) | specific_heat |
| 最高工作温度 | max_temp |
| 最低工作温度 | min_temp |
| 图片路径 | img_path |
| 备注 | comment |
| 主模式功耗 | power_main_mode |
| 校准模式功耗 | power_calibration_mode |
| 冷却系统功耗 | power_cooling_system |
| 工作电压 | operating_voltage |
| datasheet path | datasheet_path |
| 器件种类 | device category |
| 所属分系统 | belong_path |
| 器件来源 | source |
| 本体尺寸长 | body_length |
| 本体尺寸宽 | body_width |
| 本体尺寸高 | body_height |
| 质心 X 坐标 | cog_x |
| 质心 Y 坐标 | cog_y |
| 质心 Z 坐标 | cog_z |
| 工作相对湿度范围 | operating_humidity_range |
| 储存温度范围 | storage_temp_range |
| 储存相对湿度范围 | storage_humidity_range |
| 接触面积 | contact_area |
| 安装面粗糙度 | mounting_surface_roughness |
| column_42 | unnamed/empty source column |
| STEP长 | step_length |
| STEP宽 | step_width |
| STEP高 | step_height |
| Rotated CAD Path | rotated_cad_path |
| CAD_rotated_path | cad_rotated_path |
| 器件ID | component_id |
| CAD_MAJOR_PATH | cad_major_path |

## 常用查询方向

- 查找组件身份：`器件型号`、`器件名称`、`器件名称(中文)`、`器件ID`。
- 补充几何尺寸：`尺寸`、`长 mm`、`宽 mm`、`高 mm`、`本体尺寸长`、`本体尺寸宽`、`本体尺寸高`。
- 补充热参数：`导热率W/(m·K)`、`辐射率`、`热阻K/W`、`接触热阻K/W`、`比热容J/(kg·K)`。
- 补充功耗：`主模式功耗`、`校准模式功耗`、`冷却系统功耗`、`工作电压`。
- 补充材料和安装信息：`核心材料`、`安装面`、`接触面积`、`安装面粗糙度`。
- 查找 CAD 或资料路径：`CAD路径`、`Rotated CAD Path`、`CAD_rotated_path`、`CAD_MAJOR_PATH`、`datasheet path`、`图片路径`。
