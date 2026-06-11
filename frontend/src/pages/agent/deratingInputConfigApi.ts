import { joinApiPath } from '../../app/apiBase'

export type DeratingOption = {
  label: string
  value: string
  relative_path?: string
  type?: string
}

export type DeratingInputFileConfig = {
  description?: string
  relative_path?: string
  type?: string
  [key: string]: unknown
}

export type DeratingImportBaselineField = {
  channel?: string
  key: string
  label: string
  options: DeratingOption[]
  selected?: string
}

export type DeratingImportBaselineGroup = {
  fields: DeratingImportBaselineField[]
  group: DeratingOption
}

export type DeratingInputConfig = {
  compliance_config?: {
    quality_level?: {
      min_required?: string
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  input_files?: Record<string, DeratingInputFileConfig>
  quality_compare_baseline_options?: {
    domesticQualityOptions?: DeratingOption[]
    importBaselineOptions?: DeratingImportBaselineGroup[]
    [key: string]: unknown
  }
  quality_level?: {
    min_required?: string
    options?: DeratingOption[]
    selected?: string
    selected_import_baseline?: DeratingImportBaselineGroup
    selected_import_baseline_group?: string
    selected_import_baseline_label?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type DeratingInputConfigPayload = {
  config: DeratingInputConfig
  config_path?: string
  input_file_options: DeratingOption[]
  ok?: boolean
  workspace_dir?: string
}

export type DeratingWorkspaceContext = {
  versionDir?: string | null
  versionId?: string | null
  workspaceId?: string | null
}

function buildQuery(context: DeratingWorkspaceContext) {
  const params = new URLSearchParams()
  if (context.versionDir) params.set('workspaceDir', context.versionDir)
  if (context.versionId) params.set('versionId', context.versionId)
  if (context.workspaceId) params.set('workspaceId', context.workspaceId)
  return params
}

async function parseConfigResponse(response: Response) {
  const data = await response.json().catch(() => null) as DeratingInputConfigPayload | { error?: string } | null
  if (!response.ok) {
    throw new Error(data && 'error' in data && data.error ? data.error : '降额输入配置请求失败')
  }
  if (!data || !Array.isArray((data as DeratingInputConfigPayload).input_file_options)) {
    throw new Error('降额输入配置响应格式异常')
  }
  return data as DeratingInputConfigPayload
}

export async function fetchDeratingInputConfig(context: DeratingWorkspaceContext) {
  const params = buildQuery(context)
  const response = await fetch(joinApiPath(undefined, `/workspace/derating/input-config?${params.toString()}`), {
    cache: 'no-store',
  })
  return parseConfigResponse(response)
}

export async function saveDeratingInputConfig(context: DeratingWorkspaceContext, config: DeratingInputConfig) {
  const params = buildQuery(context)
  const response = await fetch(joinApiPath(undefined, `/workspace/derating/input-config?${params.toString()}`), {
    body: JSON.stringify({ config }),
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  })
  return parseConfigResponse(response)
}
