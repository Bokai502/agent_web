# 新卫星任务输入模板

这个目录是一套可直接复制的新任务初始数据包，用于当前 Open Codex Web 的 CAD 构建、CAD 校验、COMSOL 热仿真和报告生成流程。新任务只需要先准备 `00_inputs` 和组件数据库；`01_cad`、`02_sim`、`logs`、`reports` 都由工具生成。

## 目录内容

```text
new_task_template/
  00_inputs/
    real_bom.json
    layout_topology.json
    geom.json
  component_db/
    refined_device_thermal_db_format_no_structure_panels.csv
  scripts/
    validate_inputs.py
  INPUT_SCHEMA_NOTES.md
  README.md
```

## 新任务必须准备的文件

### `00_inputs/real_bom.json`

组件/BOM 和热参数主文件。它定义“有哪些设备、设备尺寸质量功耗是多少、材料是什么、组件本地安装面是什么、是否有真实 CAD 文件引用”。

关键内容：

- `items[].component_id`：稳定组件槽位 ID，例如 `P001`。必须全局唯一。
- `items[].semantic_name`：设备语义 ID，用来匹配 CSV 中的 `器件ID`。
- `items[].size_mm`：组件外形尺寸 `[长, 宽, 高]`，单位 mm。
- `items[].mass_kg`：质量，单位 kg。
- `items[].power_W`：热功耗，单位 W；大于 0 的组件会作为热源。
- `items[].material_id`：材料 ID，例如 `aluminum_6061`、`stainless_steel`。
- `items[].mounting.mount_faces[]`：组件自身哪个本地面可以贴装，例如 `P001.local_zmin`。
- `items[].source_ref.*cad*`：可选，真实 STEP/STP CAD 资产路径。

### `00_inputs/layout_topology.json`

安装拓扑和放置关系文件。它定义“卫星有哪些可安装面、每个组件安装到哪个面、组件本地安装面如何和目标安装面对齐”。

关键内容：

- `outer_shell.id`：外壳 ID。
- `install_faces[]`：可安装面列表，每个面包含 `id`、`plane_axis`、`plane_value`、`normal_sign`。
- `placements[]`：组件安装列表。每个 placement 必须引用一个 BOM 中存在的 `component_id`。
- `placements[].mount_face_id`：目标安装面 ID，必须在 `install_faces[]` 和 `geom.install_faces` 中存在。
- `placements[].component_mount_face_id`：组件本地安装面，必须在对应 BOM item 的 `mounting.mount_faces[]` 中存在。
- `placements[].alignment.in_plane_rotation_deg`：贴装后在安装面内旋转角度。
- `placements[].geometry_id`：对应 `geom.json` 中的几何实体。

### `00_inputs/geom.json`

几何真值文件。它定义“卫星外壳尺寸、安装面几何、每个组件的三维位置和包围盒”。

关键内容：

- `outer_shell.outer_bbox.min/max`：卫星外包络，单位 mm。
- `outer_shell.inner_bbox.min/max`：内包络，单位 mm。
- `outer_shell.thickness`：壳体厚度，单位 mm。
- `install_faces`：安装面的几何定义，需与 `layout_topology.install_faces[]` 对应。
- `components`：组件几何映射，每个组件包含 `component_id`、`dims`、`position`、`bbox`。
- `components.*.thermal_surface.emissivity`：表面辐射率。
- `components.*.thermal_interface.contact_resistance`：接触热阻。

### `component_db/refined_device_thermal_db_format_no_structure_panels.csv`

组件尺寸、热参数和 CAD 路径数据库。当前模板中已经放入一份现成 CSV，并在 `real_bom.json` 中用相对路径引用：

```json
"template_csv": "../component_db/refined_device_thermal_db_format_no_structure_panels.csv"
```

重要列：

- `器件ID`：与 `real_bom.items[].semantic_name` 匹配。
- `长 mm`、`宽 mm`、`高 mm`：组件尺寸。
- `质量 g`：质量，需要进入 BOM 时换算为 kg。
- `主模式功耗`：工作功耗。
- `核心材料`：材料。
- `安装面`、`CAD_LOCAL_MOUNT_FACE`：组件本地安装面说明。
- `导热率W/(m·K)`、`辐射率`、`热阻K/W`、`接触热阻K/W`、`比热容J/(kg·K)`：热属性。
- `CAD路径`、`Rotated CAD Path`、`CAD_rotated_path`、`CAD_MAJOR_PATH`：真实 CAD 文件路径候选。

### 真实 STEP/STP CAD 文件

标准 `cad build` 可以根据 `geom.json` 生成盒体模型，因此真实组件 CAD 不是最低要求。若要使用真实器件外形，需要准备 `.step` 或 `.stp` 文件，并让 CSV 的 CAD 路径列能找到它们。

当前示例 CSV 多数引用这些库：

```text
/data/wqn/cad2comsol2paraview/data/module_db/cad
/data/wqn/cad2comsol2paraview/data/module_db/cad_rotated
```

如果要做可移植任务包，建议复制所需 CAD 到：

```text
component_db/cad/
component_db/cad_rotated/
```

然后把 CSV 里的 `CAD路径`、`CAD_rotated_path` 或 `CAD_MAJOR_PATH` 改成相对路径。

## 文件之间的对应关系

每个组件必须满足：

```text
real_bom.items[].component_id
layout_topology.placements[].component_id
geom.components.*.component_id
```

三者一致。每个 placement 还必须满足：

```text
placement.mount_face_id              -> layout_topology.install_faces[].id
placement.mount_face_id              -> geom.install_faces key
placement.component_mount_face_id    -> real_bom item mounting.mount_faces[].component_mount_face_id
placement.geometry_id                -> geom.components 对应实体
```

## 静态验证输入文件

在当前模板目录运行：

```bash
cd /data/wqn/open_codex_web/new_task_template
python3 scripts/validate_inputs.py --workspace .
```

它会检查：

- 三份 JSON 是否能解析。
- 必需字段是否存在。
- BOM、layout、geom 的组件 ID 是否一致。
- placement 是否引用了存在的安装面。
- 组件本地安装面是否在 BOM 中声明。
- CSV 是否存在、表头是否包含关键字段。
- CSV 中是否能按 `semantic_name -> 器件ID` 匹配组件。
- CSV 中声明的 STEP/STP 路径是否可解析。

## 用当前工具链验证可用性

把模板复制到一个工作区后，使用当前仓库的 CLI 验证。示例直接把模板目录当工作区：

```bash
cd /data/wqn/open_codex_web
export PYTHONPATH="$PWD/backend/workflow_agents/agents/freecad_cli_tools/src:$PWD/backend/workflow_agents/agents/sim_cli_tools/src"
WORKSPACE="$PWD/new_task_template"
```

先检查 FreeCAD CLI 解析到的路径：

```bash
python -m freecad_cli_tools.cli.main config show --workspace-dir "$WORKSPACE"
```

静态准备 CAD 阶段输入并启动 CAD 构建：

```bash
python -m freecad_cli_tools.cli.main cad build --workspace-dir "$WORKSPACE"
```

CAD 构建成功后应生成：

```text
01_cad/geometry_after.step
01_cad/geometry_after.glb
01_cad/geometry_after.geom.json
01_cad/geometry_after.layout_topology.json
01_cad/geometry_after_registry.json
01_cad/simulation_input.json
01_cad/comsol_inputs/coord.txt
01_cad/comsol_inputs/channels_input.npz
```

再做 CAD 校验：

```bash
python -m freecad_cli_tools.cli.main cad validate --workspace-dir "$WORKSPACE"
```

仿真前先做输入体检：

```bash
python -m sim_cli_tools.cli.main --json doctor --workspace-dir "$WORKSPACE"
```

如果 `doctor` 通过，并且 COMSOL 环境可用，再运行真实仿真：

```bash
python -m sim_cli_tools.cli.main \
  --json run \
  --workspace-dir "$WORKSPACE" \
  --simulation-backend comsol_local \
  --mph-port 32036 \
  --force \
  --quiet \
  --async-open-tools
```

仿真成功后重点检查：

```text
02_sim/run_manifest.json
02_sim/simulation/status.json
02_sim/simulation/work.mph
02_sim/simulation/native.vtu
02_sim/postprocess/temperature_field_threejs.json
02_sim/analysis/metrics_summary.json
logs/progress.json
```

## 新卫星替换流程

1. 复制 `new_task_template` 到新的 workspace 版本目录。
2. 修改 `component_db/*.csv`，填入新卫星组件库和 CAD 路径。
3. 修改 `00_inputs/real_bom.json`，列出新卫星所有组件。
4. 修改 `00_inputs/layout_topology.json`，定义安装面和组件贴装关系。
5. 修改 `00_inputs/geom.json`，定义外壳、安装面和组件三维包围盒。
6. 运行 `python3 scripts/validate_inputs.py --workspace <workspace>`。
7. 运行 `cad build`、`cad validate`。
8. 运行 `sim doctor`，通过后再运行 COMSOL 仿真。
