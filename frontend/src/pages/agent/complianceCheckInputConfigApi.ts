import { joinApiPath } from '../../app/apiBase'

export type ComplianceCheckOption = {
  label: string
  value: string
  relative_path?: string
  type?: string
}

export type ComplianceCheckInputFileConfig = {
  description?: string
  relative_path?: string
  type?: string
  [key: string]: unknown
}

export type ComplianceCheckImportBaselineField = {
  channel?: string
  key: string
  label: string
  options: ComplianceCheckOption[]
  selected?: string
}

export type ComplianceCheckImportBaselineGroup = {
  fields: ComplianceCheckImportBaselineField[]
  group: ComplianceCheckOption
}

export type ComplianceCheckInputConfig = {
  compliance_config?: {
    quality_level?: {
      min_required?: string
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  input_files?: Record<string, ComplianceCheckInputFileConfig>
  quality_compare_baseline_options?: {
    domesticQualityOptions?: ComplianceCheckOption[]
    importBaselineOptions?: ComplianceCheckImportBaselineGroup[]
    [key: string]: unknown
  }
  quality_level?: {
    min_required?: string
    options?: ComplianceCheckOption[]
    selected?: string
    selected_import_baseline?: ComplianceCheckImportBaselineGroup
    selected_import_baseline_group?: string
    selected_import_baseline_label?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type ComplianceCheckInputConfigPayload = {
  config: ComplianceCheckInputConfig
  config_path?: string
  input_file_options: ComplianceCheckOption[]
  ok?: boolean
  workspace_dir?: string
}

export type ComplianceCheckWorkspaceContext = {
  versionDir?: string | null
  versionId?: string | null
  workspaceId?: string | null
}

function buildQuery(context: ComplianceCheckWorkspaceContext) {
  const params = new URLSearchParams()
  if (context.versionDir) params.set('workspaceDir', context.versionDir)
  if (context.versionId) params.set('versionId', context.versionId)
  if (context.workspaceId) params.set('workspaceId', context.workspaceId)
  return params
}

async function parseConfigResponse(response: Response) {
  const data = await response.json().catch(() => null) as ComplianceCheckInputConfigPayload | { error?: string } | null
  if (!response.ok) {
    throw new Error(data && 'error' in data && data.error ? data.error : '降额输入配置请求失败')
  }
  if (!data || !Array.isArray((data as ComplianceCheckInputConfigPayload).input_file_options)) {
    throw new Error('降额输入配置响应格式异常')
  }
  return data as ComplianceCheckInputConfigPayload
}

export async function fetchComplianceCheckInputConfig(context: ComplianceCheckWorkspaceContext) {
  const params = buildQuery(context)
  const response = await fetch(joinApiPath(undefined, `/workspace/derating/input-config?${params.toString()}`), {
    cache: 'no-store',
  })
  return parseConfigResponse(response)
}

export async function saveComplianceCheckInputConfig(context: ComplianceCheckWorkspaceContext, config: ComplianceCheckInputConfig) {
  const params = buildQuery(context)
  const response = await fetch(joinApiPath(undefined, `/workspace/derating/input-config?${params.toString()}`), {
    body: JSON.stringify({ config }),
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  })
  return parseConfigResponse(response)
}
