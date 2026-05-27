import WorkspacePageShell from "./WorkspacePageShell"

const GNC_DIGITAL_EARTH_URL = "http://10.110.10.11:8765/"

export default function GncWorkspacePage() {
  return (
    <WorkspacePageShell
      apiBase="/api/gnc"
      enableGncConfig
      homePath="/gnc-workspace"
      modelViewerUrl={GNC_DIGITAL_EARTH_URL}
      progressVariant="gnc"
      showBom={false}
    />
  )
}
