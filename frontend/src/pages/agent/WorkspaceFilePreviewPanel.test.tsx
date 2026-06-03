import { describe, expect, it } from 'vitest'
import { createMarkdownImageResolver, normalizeWorkspacePath } from './WorkspaceFilePreviewPanel'
import type { WorkspaceFilePreview } from './types'

describe('WorkspaceFilePreviewPanel markdown image paths', () => {
  it('keeps absolute workspace roots when resolving relative report images', () => {
    const file: WorkspaceFilePreview = {
      content: '![front](../01_cad/freecad_screenshot_front.png)',
      encoding: 'utf-8',
      mimeType: 'text/markdown',
      mtimeMs: 0,
      name: 'report.md',
      relativePath: 'reports/report.md',
      size: 0,
      type: 'text',
    }
    const resolveImage = createMarkdownImageResolver({
      versionDir: '/data/lbk/codex_web/data/input_data/workspaces/ws_thermal/versions/v0008',
    }, file)

    expect(normalizeWorkspacePath('/data/lbk/../lbk/file.png')).toBe('/data/lbk/file.png')
    expect(resolveImage('../01_cad/freecad_screenshot_front.png')).toBe(
      '/api/image?path=%2Fdata%2Flbk%2Fcodex_web%2Fdata%2Finput_data%2Fworkspaces%2Fws_thermal%2Fversions%2Fv0008%2F01_cad%2Ffreecad_screenshot_front.png'
    )
  })
})
