# FreeCAD CLI Tools

用于操作 FreeCAD 文档、布局数据集以及直接装配构建工作流的命令行工具集合。
该包同时包含基于 XML-RPC 的命令和离线数据集工具。

英文版说明见 [README.md](./README.md)。

## 安装

### 方式一：从源码安装

```bash
cd /data/lbk/codex_web/freecad_skills/freecad-skill/freecad_cli_tools
python -m pip install -e .
```

### 方式二：构建并安装 wheel

```bash
cd /data/lbk/codex_web/freecad_skills/freecad-skill/freecad_cli_tools
python -m pip install build
python -m build
python -m pip install dist/freecad_cli_tools-*.whl
```

## 使用方式

从源码检出目录中，进入包目录后运行统一 CLI 模块：

```bash
cd /data/lbk/codex_web/freecad_skills/freecad-skill/freecad_cli_tools

# 配置
python -m freecad_cli_tools.cli.main config show

# 装配生成
python -m freecad_cli_tools.cli.main assembly create-from-component-info --doc-name DirectAssembly
python -m freecad_cli_tools.cli.main cad build
python -m freecad_cli_tools.cli.main cad validate

# 基于 layout dataset 的安全移动与默认 CAD 同步
python -m freecad_cli_tools.cli.main layout safe-move --component P001 --move 50 50 0
python -m freecad_cli_tools.cli.main layout safe-move --component P001 --move 50 50 0 --format json
python -m freecad_cli_tools.cli.main layout safe-move --component P001 --move 50 50 0 --no-sync-cad
python -m freecad_cli_tools.cli.main layout safe-move --component P002 --install-face 4 --move 0 0 0
```

完成 editable 或 wheel 安装后，`freecad-tools` 可作为相同命令的短 console-script 别名。

工作区相关命令会从 `/data/lbk/codex_web/config.json` 的
`freecad.workspaceDir` 字段解析相对路径。`--workspace` 仅作为弃用兼容选项保留，
不会覆盖配置中的工作区。

`python -m freecad_cli_tools.cli.main assembly create-from-component-info` 会读取
`./00_inputs/real_bom.json`、`./00_inputs/layout_topology.json` 和
`./00_inputs/geom.json`。命令会通过每个 BOM 条目的 `semantic_name`
到 `real_bom.source.template_csv` 中解析真实 STEP/STP 资产；如果显式传入
`--geom-component-info`，则用该文件覆盖自动合成的 component info。
STEP 资产缺失或不可读时回退为 `Part::Box`。超过 `--max-step-size-mb`
的 STEP/STP 也会回退为 `Part::Box`，传 `-1` 可以关闭这个限制。这个直接构建流程输出
`./01_cad/component_info_assembly.step` 和同名
`component_info_assembly.glb`。

`python -m freecad_cli_tools.cli.main cad build` 会读取 `./00_inputs/real_bom.json`、
`./00_inputs/layout_topology.json` 和 `./00_inputs/geom.json`，并把 CAD
阶段产物写到 `./01_cad`：

- `geometry_after.step`
- `geometry_after.glb`
- `simulation_input.json`
- `cad_agent_output.json`

它还会写出兼容旧 after-state 的文件，例如
`geometry_after.geom.json`、`geometry_after.layout_topology.json`、
`geometry_after_registry.json`，以及 COMSOL 输入文件
`comsol_inputs/coord.txt` 和 `comsol_inputs/channels_input.npz`。

`python -m freecad_cli_tools.cli.main cad validate` 会校验 `./01_cad` 产物与 `./00_inputs`
是否一致，并把校验报告直接写入 `./01_cad/cad_agent_output.json` 的
`validation` 字段。默认还会通过 FreeCAD RPC 截取当前 CAD 文档六面视图，
写到 `./01_cad/freecad_screenshot_top.png`、
`./01_cad/freecad_screenshot_bottom.png`、`./01_cad/freecad_screenshot_front.png`、
`./01_cad/freecad_screenshot_back.png`、`./01_cad/freecad_screenshot_left.png`
和 `./01_cad/freecad_screenshot_right.png`，并把图片路径写入
`cad_agent_output.json` 的顶层 `screenshot` 字段。可用
`--no-screenshot` 跳过截图。

所有一等 CLI 输出都会包含进度百分比：

- `layout_completion_percent`：布局/数据集阶段完成百分比。
- `modeling_percent`：FreeCAD 建模或 CAD 同步阶段完成百分比。
- `export_file_percent`：导出文件完成百分比；STEP 和 GLB 各占 50%。

对于只处理数据集的 `python -m freecad_cli_tools.cli.main layout safe-move`，没有请求 CAD 建模和导出，
因此 `modeling_percent` 与 `export_file_percent` 为 `0.0`。
最近一次运行的百分比也会写入
`$FREECAD_WORKSPACE_DIR/logs/progress_percentages.json`。该文件还包含
`output_files` 对象，记录每个产出文件路径及其是否存在。
执行 CAD 操作时，FreeCAD 侧脚本会在建模和 STEP/GLB 导出阶段实际推进时刷新该文件。

## 推荐移动流程

只要你手头有 `layout_topology.json` 和 `geom.json`，就建议把这对数据集作为单一事实来源：

1. 先运行 `python -m freecad_cli_tools.cli.main layout safe-move`。
2. 让它计算安全移动，把新的数据集写到 `./01_cad`，并更新 CAD STEP/GLB。
3. 只有明确需要纯 JSON 离线更新时，才附加 `--no-sync-cad`。
4. 需要从 `00_inputs` 重新生成完整 CAD 阶段产物时，运行 `python -m freecad_cli_tools.cli.main cad build`。

## Layout Dataset 离线移动命令

`python -m freecad_cli_tools.cli.main layout safe-move` 是面向布局数据集的主移动命令。它默认会把批准后的结果同步到正在运行的 FreeCAD 文档，并导出 `geometry_after.step` 和 `geometry_after.glb`；只有传入 `--no-sync-cad` 时才只做 JSON 离线更新。

在 v9 工作区流程中，移动和旋转请求默认会从 `./00_inputs`
读取输入，并把新的数据集、`geometry_after.step`、`geometry_after.glb`
写到 `./01_cad`；只有在用户明确要求时，才覆盖原路径或指定其他输出。

适用场景包括：

- 在 `layout_topology.json + geom.json` 中移动单个组件
- 检测该组件与其它组件之间的盒体碰撞
- 在移动时保持当前朝向，或显式将组件重定向安装到另一个包络面
- 保证组件始终位于 `envelope.inner_size` 内
- 让外部安装面（6-11）的移动继续受目标墙面二维边界约束，若请求路径越界则返回 `FACE_BOUNDARY`
- 将新的位置和安装信息反写到 `layout_topology.json` 与 `geom.json`
- 默认把更新后的结果同步到打开中的 FreeCAD 文档并导出 STEP/GLB

该命令把 `placement.position` 视为组件局部包围盒最小角点位置，并默认在当前朝向下执行安全碰撞移动。在当前归一化模型里：

- `placement.mount_face` 表示组件安装到的包络面（`0..11`）
- `placement.rotation_matrix` 表示装配朝向

当传入 `--install-face` 时，命令会把组件旋转到“原组件接触面安装到目标包络面”的姿态，从目标面的中心位置开始，再把请求的移动量当作该安装面内的偏移量来执行。如果完整请求安全，就直接采用；如果不安全，就选择这条路径上的最近安全前缀；如果请求路径上没有安全点，命令会报告“未找到解”，但仍会写出受约束后的数据集结果。除非传入 `--no-sync-cad`，否则它会把最终计算出的位姿直接同步到目标 FreeCAD 文档里的对应对象，并导出 STEP/GLB。

补充说明：外部安装面（6-11）虽然会跳过内部包络包含约束，但仍会使用 `envelope.outer_size` 检查目标墙面的面内边界，避免组件沿墙面滑出边缘。如果请求路径跨出了这个二维轮廓，命令会截断到最近安全前缀，并在阻塞原因中包含 `FACE_BOUNDARY`。

工作区解析规则是确定的：

- 推荐：显式传入 `--workspace /abs/path/to/workspace`
- 第一兜底：提前导出 `FREECAD_WORKSPACE_DIR=/abs/path/to/workspace`
- 第二兜底：提前导出 `WORKSPACE_DIR=/abs/path/to/workspace`
- 最后兜底：配置 codex-web 工作区目录

## 开发布局

- `src/freecad_cli_tools/cli/`：轻量级命令入口
- `src/freecad_cli_tools/geometry.py`：纯几何运算、碰撞检测和组件形状辅助函数（无外部依赖）
- `src/freecad_cli_tools/layout_dataset.py`：layout dataset 归一化与反写
- `src/freecad_cli_tools/layout_dataset_common.py`：layout dataset 共享校验辅助函数
- `src/freecad_cli_tools/layout_dataset_faces.py`：安装面映射与反向解析
- `src/freecad_cli_tools/layout_dataset_io.py`：layout dataset 原子 JSON I/O
- `src/freecad_cli_tools/component_info_assembly.py`：基于 `geom_component_info.json` 的直接装配归一化逻辑
- `src/freecad_cli_tools/freecad_sync.py`：单组件和批量组件的位姿同步辅助逻辑
- `src/freecad_cli_tools/cli_support.py`：CLI 侧共享工具，例如 RPC 调用、输出解析和文件输入
- `src/freecad_cli_tools/rpc_scripts/`：通过 XML-RPC 在 FreeCAD 侧执行的 Python 脚本
- `src/freecad_cli_tools/rpc_script_loader.py`：打包脚本加载和占位符渲染
- `src/freecad_cli_tools/rpc_script_fragments.py`：可注入脚本模板的 FreeCAD 侧公共代码片段
- `tests/`：几何算法、格式校验、片段同步验证和 RPC 模板语法的单元测试

## 依赖要求

- 对于 RPC 命令：需要安装并运行带 MCP 插件的 FreeCAD，RPC 服务使用 CLI 参数或环境变量中的主机和端口
- 相对输入输出路径会基于 `--workspace` 或 `FREECAD_WORKSPACE_DIR` 解析
- 对于离线 layout dataset 模式的 `python -m freecad_cli_tools.cli.main layout safe-move`：只需要 Python 3.9+
- Python 3.9+

## 许可证

MIT
