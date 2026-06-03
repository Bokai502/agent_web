import { getGncToolUrl } from "../app/runtimeConfig"
import WorkspacePageShell from "./WorkspacePageShell"

export default function GncWorkspacePage() {
  return (
    <WorkspacePageShell
      apiBase="/api/gnc"
      enableGncConfig
      homePath="/gnc-workspace"
      modelViewerUrl={getGncToolUrl()}
      progressVariant="gnc"
      showBom={false}
    />
  )
}
