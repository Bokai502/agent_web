import { describe, expect, it } from "vitest"
import { resolveWorkspaceVersionContext, type WorkspacesResponse } from "./workspaceVersion"

describe("resolveWorkspaceVersionContext", () => {
  it("does not reuse an effective version path when the workspace index reports no current version", () => {
    const workspaces: WorkspacesResponse = {
      current: null,
      currentName: "lbk",
      effective: "/data/FreeCAD_data/workspaces/ws_lbk/versions/v0001",
      items: [
        {
          manifestRoot: "/data/FreeCAD_data/workspaces/ws_lbk",
          name: "lbk",
          path: "/data/FreeCAD_data/lbk",
          sourcePath: "/data/FreeCAD_data/lbk",
          valid: true,
          versionWorkspaceDir: undefined,
        },
      ],
      root: "/data/FreeCAD_data",
    }

    const context = resolveWorkspaceVersionContext({
      branchManifest: {
        activeVersionId: null,
        rootDir: "/data/FreeCAD_data/workspaces/ws_lbk",
        versions: [],
        workspaceId: "ws_lbk",
      },
      fallbackWorkspaceName: "未选择",
      workspaces,
    })

    expect(context.workspaceName).toBe("lbk")
    expect(context.versionDir).toBeNull()
    expect(context.versionId).toBeNull()
    expect(context.sourceWorkspaceDir).toBeNull()
  })

  it("ignores stale manifest activeVersionId when no matching version remains", () => {
    const context = resolveWorkspaceVersionContext({
      branchManifest: {
        activeVersionId: "v0001",
        rootDir: "/data/FreeCAD_data/workspaces/ws_lbk",
        versions: [],
        workspaceId: "ws_lbk",
      },
      fallbackWorkspaceName: "未选择",
      workspaces: {
        current: null,
        currentName: "lbk",
        items: [],
        root: "/data/FreeCAD_data",
      },
    })

    expect(context.versionDir).toBeNull()
    expect(context.versionId).toBeNull()
  })

  it("does not let a stale manifest override the currently selected workspace", () => {
    const context = resolveWorkspaceVersionContext({
      branchManifest: {
        activeVersionId: null,
        rootDir: "/data/FreeCAD_data/workspaces/ws_v10_data_39e144",
        versions: [],
        workspaceId: "ws_v10_data_39e144",
      },
      fallbackWorkspaceName: "未选择",
      workspaces: {
        current: "/data/FreeCAD_data/workspaces/ws_v9_data/versions/v0001",
        currentName: "v9_data",
        effective: "/data/FreeCAD_data/workspaces/ws_v9_data/versions/v0001",
        items: [
          {
            manifestRoot: "/data/FreeCAD_data/workspaces/ws_v9_data",
            name: "v9_data",
            path: "/data/FreeCAD_data/workspaces/ws_v9_data/versions/v0001",
            sourcePath: "/data/FreeCAD_data/v9_data",
            valid: true,
            versionWorkspaceDir: "/data/FreeCAD_data/workspaces/ws_v9_data/versions/v0001",
          },
        ],
        root: "/data/FreeCAD_data",
      },
    })

    expect(context.workspaceId).toBe("ws_v9_data")
    expect(context.workspaceKey).toBe("ws_v9_data")
    expect(context.versionDir).toBe("/data/FreeCAD_data/workspaces/ws_v9_data/versions/v0001")
    expect(context.versionId).toBeNull()
  })
})
