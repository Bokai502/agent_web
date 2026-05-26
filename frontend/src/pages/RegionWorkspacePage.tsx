import WorkspacePageShell from "./WorkspacePageShell"

export default function RegionWorkspacePage() {
  return (
    <WorkspacePageShell
      apiBase="/api/region"
      homePath="/region-workspace"
      progressVariant="gnc"
      showBom={false}
      showModel={false}
      showTools={false}
    />
  )
}
