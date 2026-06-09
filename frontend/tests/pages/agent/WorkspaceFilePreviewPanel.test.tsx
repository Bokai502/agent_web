import { describe, expect, it } from "vitest"
import { createMarkdownImageResolver, normalizeMarkdownPreview, normalizeWorkspacePath } from "../../../src/pages/agent/WorkspaceFilePreviewPanel"
import type { WorkspaceFilePreview } from "../../../src/pages/agent/types"

describe("WorkspaceFilePreviewPanel markdown image paths", () => {
  it("keeps absolute workspace roots when resolving relative report images", () => {
    const file: WorkspaceFilePreview = {
      content: "![front](../01_cad/freecad_screenshot_front.png)",
      encoding: "utf-8",
      mimeType: "text/markdown",
      mtimeMs: 0,
      name: "report.md",
      relativePath: "reports/report.md",
      size: 0,
      type: "text",
    }
    const resolveImage = createMarkdownImageResolver({
      versionDir: "/tmp/open-codex-web/data/workspaces/ws_thermal/versions/v0008",
    }, file)

    expect(normalizeWorkspacePath("/data/lbk/../lbk/file.png")).toBe("/data/lbk/file.png")
    expect(resolveImage("../01_cad/freecad_screenshot_front.png")).toBe(
      "/api/image?path=%2Ftmp%2Fopen-codex-web%2Fdata%2Fworkspaces%2Fws_thermal%2Fversions%2Fv0008%2F01_cad%2Ffreecad_screenshot_front.png"
    )
  })

  it("resolves workspace-root image paths from markdown report lists", () => {
    const file: WorkspaceFilePreview = {
      content: "![top](02_sim/postprocess/3d_top.png)",
      encoding: "utf-8",
      mimeType: "text/markdown",
      mtimeMs: 0,
      name: "thermal_simulation_report.md",
      relativePath: "reports/thermal_simulation_report.md",
      size: 0,
      type: "text",
    }
    const resolveImage = createMarkdownImageResolver({
      versionDir: "/tmp/open-codex-web/data/users/default/workspaces/ws_thermal/versions/v0001",
    }, file)

    expect(resolveImage("02_sim/postprocess/3d_top.png")).toBe(
      "/api/image?path=%2Ftmp%2Fopen-codex-web%2Fdata%2Fusers%2Fdefault%2Fworkspaces%2Fws_thermal%2Fversions%2Fv0001%2F02_sim%2Fpostprocess%2F3d_top.png"
    )
  })

  it("converts standalone report image path list items into markdown images", () => {
    expect(normalizeMarkdownPreview([
      "后处理图片：",
      "",
      "- `02_sim/postprocess/3d_top.png`",
      "- `01_cad/freecad_screenshot_front.png`",
      "普通文字 `02_sim/postprocess/3d_front.png` 不应转换",
    ].join("\n"))).toContain("![3d_top.png](02_sim/postprocess/3d_top.png)")
  })
})
