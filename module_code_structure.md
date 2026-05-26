# open_codex_web 模块代码结构

```text
open_codex_web/
├── README.md
│   └── 对话管理：项目功能总览
│
├── backend/
│   ├── scripts/
│   │   └── Agent 执行层：Agent 工作流说明
│   │
│   ├── src/
│   │   ├── codex-run/
│   │   │   └── Agent 调度/执行、Agent 执行层
│   │   │
│   │   ├── sessions/
│   │   │   └── 对话管理
│   │   │
│   │   ├── system/
│   │   │   └── Skill 管理、系统支撑能力
│   │   │
│   │   ├── manifests/
│   │   │   └── 版本管理、运行记录、产物数据
│   │   │
│   │   ├── workspaces/
│   │   │   └── 进度管理、工作区数据、BOM、模型、阶段日志
│   │   │
│   │   ├── artifacts/
│   │   │   └── 支撑层：数据产物访问
│   │   │
│   │   ├── server/
│   │   │   └── 支撑层：后端服务与路由组织
│   │   │
│   │   └── shared/
│   │       └── 支撑层：公共工具与通用逻辑
│   │
│   └── workflow_agents/
│       ├── thermal_skills/
│       │   └── 热仿真设计套件、FreeCAD、COMSOL、ParaView 工具能力
│       │
│       └── gnc_skills/
│           └── 姿轨控套件、42 工具能力
│
└── frontend/
    └── src/
        ├── components/
        │   └── 对话管理、任务输入、Agent 输出展示
        │
        ├── pages/
        │   └── 工作区页面、会话页面、版本与进度展示
        │
        └── pages/viewer3d/
            └── 支撑层：模型查看与 3D 数据展示
```

## 模块快速对应

| 模块 | 文件夹位置 |
| --- | --- |
| 对话管理 | `backend/src/sessions/`、`frontend/src/components/`、`frontend/src/pages/` |
| Skill 管理 | `backend/src/system/`、`backend/workflow_agents/` |
| Agent 调度/执行 | `backend/src/codex-run/`、`frontend/src/components/` |
| 版本管理 | `backend/src/manifests/`、`frontend/src/pages/` |
| 进度管理 | `backend/src/workspaces/`、`frontend/src/pages/workspace/` |
| 热仿真设计套件 | `backend/workflow_agents/thermal_skills/` |
| 姿轨控套件 | `backend/workflow_agents/gnc_skills/` |
| 支撑层：数据 | `backend/src/workspaces/`、`backend/src/manifests/`、`backend/src/artifacts/`、`frontend/src/pages/viewer3d/` |
| 支撑层：核心代码 | `backend/src/server/`、`backend/src/shared/`、`backend/src/` |
| 支撑层：工具 | `backend/workflow_agents/thermal_skills/`、`backend/workflow_agents/gnc_skills/` |
| Agent 执行层 | `backend/scripts/`、`backend/src/codex-run/`、`frontend/src/components/` |
