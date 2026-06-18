import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import '../../../gnc_config/gnc_config.css'
import {
  fetchComplianceCheckInputConfig,
  saveComplianceCheckInputConfig,
  type ComplianceCheckImportBaselineGroup,
  type ComplianceCheckInputConfig,
  type ComplianceCheckOption,
  type ComplianceCheckWorkspaceContext,
} from './complianceCheckInputConfigApi'

type ComplianceCheckInputConfigEditorProps = {
  activeContext: ComplianceCheckWorkspaceContext
}

function cloneConfig(config: ComplianceCheckInputConfig): ComplianceCheckInputConfig {
  return JSON.parse(JSON.stringify(config)) as ComplianceCheckInputConfig
}

function normalizeOptions(options: unknown): ComplianceCheckOption[] {
  if (!Array.isArray(options)) return []
  return options
    .map(option => {
      if (typeof option === 'string') return { label: option, value: option }
      if (!option || typeof option !== 'object' || Array.isArray(option)) return null
      const record = option as Record<string, unknown>
      const value = typeof record.value === 'string' ? record.value : typeof record.label === 'string' ? record.label : ''
      if (!value) return null
      return {
        ...record,
        label: typeof record.label === 'string' ? record.label : value,
        value,
      } as ComplianceCheckOption
    })
    .filter((option): option is ComplianceCheckOption => !!option)
}

function getQualityOptions(config: ComplianceCheckInputConfig) {
  return normalizeOptions(config.quality_level?.options ?? config.quality_compare_baseline_options?.domesticQualityOptions)
}

function getImportBaselineGroups(config: ComplianceCheckInputConfig) {
  const groups = Array.isArray(config.quality_compare_baseline_options?.importBaselineOptions)
    ? config.quality_compare_baseline_options.importBaselineOptions
    : []
  return groups.map(group => ({
    ...group,
    fields: group.fields.map(field => {
      const hasIndustrial = field.options.some(option => option.value === '工业级')
      return hasIndustrial
        ? field
        : {
            ...field,
            options: [...field.options, { label: '工业级', value: '工业级' }],
          }
    }),
  }))
}

function getSelectedBaselineGroup(config: ComplianceCheckInputConfig, groups: ComplianceCheckImportBaselineGroup[]) {
  const selected = config.quality_level?.selected_import_baseline_group
  return groups.find(group => group.group.value === selected) ?? groups[0] ?? null
}

function updateInputFile(config: ComplianceCheckInputConfig, key: string, filename: string, options: ComplianceCheckOption[]) {
  const next = cloneConfig(config)
  const current = next.input_files?.[key] ?? {}
  const option = options.find(item => item.value === filename)
  next.input_files = {
    ...(next.input_files ?? {}),
    [key]: {
      ...current,
      relative_path: filename,
      type: current.type || option?.type || 'file',
    },
  }
  return next
}

function updateQuality(config: ComplianceCheckInputConfig, selected: string) {
  const next = cloneConfig(config)
  next.quality_level = {
    ...(next.quality_level ?? {}),
    min_required: selected,
    selected,
  }
  next.compliance_config = {
    ...(next.compliance_config ?? {}),
    quality_level: {
      ...(next.compliance_config?.quality_level ?? {}),
      min_required: selected,
    },
  }
  return next
}

function updateBaselineGroup(config: ComplianceCheckInputConfig, group: ComplianceCheckImportBaselineGroup) {
  const next = cloneConfig(config)
  const normalizedGroup = {
    ...group,
    fields: group.fields.map(field => ({
      ...field,
      selected: field.selected ?? field.options[0]?.value ?? '',
    })),
  }
  next.quality_level = {
    ...(next.quality_level ?? {}),
    selected_import_baseline: normalizedGroup,
    selected_import_baseline_group: normalizedGroup.group.value,
    selected_import_baseline_label: normalizedGroup.group.label,
  }
  return next
}

function updateBaselineField(config: ComplianceCheckInputConfig, fieldKey: string, value: string) {
  const next = cloneConfig(config)
  const selectedBaseline = next.quality_level?.selected_import_baseline
  if (!selectedBaseline) return next
  next.quality_level = {
    ...(next.quality_level ?? {}),
    selected_import_baseline: {
      ...selectedBaseline,
      fields: selectedBaseline.fields.map(field =>
        field.key === fieldKey ? { ...field, selected: value } : field,
      ),
    },
  }
  return next
}

function normalizeSelectedBaseline(config: ComplianceCheckInputConfig) {
  const groups = getImportBaselineGroups(config)
  const selected = config.quality_level?.selected_import_baseline
  if (selected) {
    return updateBaselineGroup(config, selected)
  }
  return groups[0] ? updateBaselineGroup(config, groups[0]) : config
}

function getOptionLabel(options: ComplianceCheckOption[], value?: string) {
  if (!value) return '未选择'
  return options.find(option => option.value === value)?.label ?? value
}

function getStatusTone(status: string) {
  return /失败|异常|错误|error/i.test(status) ? 'bad' : /保存|加载|已/.test(status) ? 'ok' : 'neutral'
}

function EditorCard({ children, meta, subtitle, title }: { children: ReactNode; meta?: ReactNode; subtitle: string; title: string }) {
  return (
    <section className="derating-config-card">
      <div className="derating-config-card-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        {meta ? <div className="derating-config-card-meta">{meta}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function ComplianceCheckInputConfigEditor({ activeContext }: ComplianceCheckInputConfigEditorProps) {
  const [config, setConfig] = useState<ComplianceCheckInputConfig | null>(null)
  const [configPath, setConfigPath] = useState('')
  const [inputFileOptions, setInputFileOptions] = useState<ComplianceCheckOption[]>([])
  const [status, setStatus] = useState('准备读取 input_config.json')
  const [saving, setSaving] = useState(false)
  const workspaceContext = useMemo(() => ({
    versionDir: activeContext.versionDir,
    versionId: activeContext.versionId,
    workspaceId: activeContext.workspaceId,
  }), [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId])
  const inputFileEntries = useMemo(() => Object.entries(config?.input_files ?? {}), [config])
  const qualityOptions = useMemo(() => config ? getQualityOptions(config) : [], [config])
  const importBaselineGroups = useMemo(() => config ? getImportBaselineGroups(config) : [], [config])
  const selectedBaseline = useMemo(() => {
    if (!config) return null
    return getSelectedBaselineGroup(config, importBaselineGroups)
  }, [config, importBaselineGroups])
  const displayedBaseline = config?.quality_level?.selected_import_baseline ?? selectedBaseline
  const configuredFileCount = useMemo(
    () => inputFileEntries.filter(([, value]) => value.relative_path).length,
    [inputFileEntries],
  )
  const selectedQualityLabel = useMemo(
    () => getOptionLabel(qualityOptions, config?.quality_level?.selected),
    [config?.quality_level?.selected, qualityOptions],
  )
  const statusTone = getStatusTone(status)

  const loadConfig = useCallback(async () => {
    setStatus('正在读取 workspaceDir/00_inputs/input_config.json')
    const payload = await fetchComplianceCheckInputConfig(workspaceContext)
    const nextConfig = cloneConfig(payload.config)
    setConfig(normalizeSelectedBaseline(nextConfig))
    setConfigPath(payload.config_path ?? '')
    setInputFileOptions(payload.input_file_options)
    setStatus('配置已加载')
  }, [workspaceContext])

  useEffect(() => {
    loadConfig().catch(error => {
      setConfig(null)
      setStatus(error instanceof Error ? error.message : '读取 input_config.json 失败')
    })
  }, [loadConfig])

  const saveConfig = async () => {
    if (!config || saving) return
    setSaving(true)
    setStatus('正在写回 input_config.json')
    try {
      const payload = await saveComplianceCheckInputConfig(workspaceContext, config)
      setConfig(cloneConfig(payload.config))
      setConfigPath(payload.config_path ?? configPath)
      setInputFileOptions(payload.input_file_options)
      setStatus('input_config.json 已保存')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存 input_config.json 失败')
    } finally {
      setSaving(false)
    }
  }

  if (!config) {
    return (
      <div className="derating-config-shell">
        <div className={`derating-config-empty is-${getStatusTone(status)}`}>{status}</div>
      </div>
    )
  }

  return (
    <div className="derating-config-shell">
      <div className="derating-config-top">
        <div className="derating-config-title">
          <span>降额合规输入</span>
          <strong>配置文件</strong>
          <small>{configPath || 'workspaceDir/00_inputs/input_config.json'}</small>
        </div>
        <div className="derating-config-actions">
          <button type="button" disabled={saving} onClick={() => loadConfig().catch(error => setStatus(error instanceof Error ? error.message : '读取失败'))}>重新读取</button>
          <button type="button" className="primary" disabled={saving} onClick={() => saveConfig()}>{saving ? '保存中' : '保存配置'}</button>
        </div>
      </div>

      <div className="derating-config-summary">
        <div className="derating-config-stat">
          <span>输入文件</span>
          <strong>{configuredFileCount}/{inputFileEntries.length}</strong>
        </div>
        <div className="derating-config-stat">
          <span>国产质量等级</span>
          <strong>{selectedQualityLabel}</strong>
        </div>
        <div className="derating-config-stat">
          <span>进口基线组</span>
          <strong>{displayedBaseline?.group.label ?? '未选择'}</strong>
        </div>
        <div className={`derating-config-status is-${statusTone}`}>{status}</div>
      </div>

      <div className="derating-config-layout">
        <EditorCard
          title="输入文件映射"
          subtitle="选择本工作区 00_inputs 下用于合规检查的源文件"
          meta={<span>{inputFileOptions.length} 个可选文件</span>}
        >
          <div className="derating-file-grid">
            {inputFileEntries.map(([key, value]) => (
              <div key={key} className="derating-file-row">
                <div className="derating-file-copy">
                  <strong>{value.description || key}</strong>
                  <span>{key}</span>
                </div>
                <label>
                  <span>文件</span>
                  <select
                    value={value.relative_path ?? ''}
                    onChange={event => setConfig(updateInputFile(config, key, event.target.value, inputFileOptions))}
                  >
                    <option value="">未选择</option>
                    {inputFileOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            ))}
          </div>
        </EditorCard>

        <div className="derating-config-side">
          <EditorCard title="国产质量等级" subtitle="设置降额检查要求的最低质量等级">
            <label className="derating-select-field">
              <span>最低要求</span>
              <select
                value={config.quality_level?.selected ?? ''}
                onChange={event => setConfig(updateQuality(config, event.target.value))}
              >
                {qualityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </EditorCard>

          <EditorCard title="进口质量基线" subtitle="选择进口器件质量等级的对照基线">
            <label className="derating-select-field">
              <span>基线组</span>
              <select
                value={displayedBaseline?.group.value ?? ''}
                onChange={event => {
                  const group = importBaselineGroups.find(item => item.group.value === event.target.value)
                  if (group) setConfig(updateBaselineGroup(config, group))
                }}
              >
                {importBaselineGroups.map(group => <option key={group.group.value} value={group.group.value}>{group.group.label}</option>)}
              </select>
            </label>
          </EditorCard>
        </div>

        <EditorCard
          title="进口质量规则"
          subtitle="按当前基线组设置各通道的质量等级判据"
          meta={<span>{displayedBaseline?.fields.length ?? 0} 条规则</span>}
        >
          <div className="derating-rule-grid">
            {(displayedBaseline?.fields ?? []).map(field => (
              <div key={field.key} className="derating-rule-row">
                <div>
                  <strong>{field.label}</strong>
                  <span>{field.channel || field.key}</span>
                </div>
                <select
                  value={field.selected ?? field.options[0]?.value ?? ''}
                  onChange={event => setConfig(updateBaselineField(config, field.key, event.target.value))}
                >
                  {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </EditorCard>
      </div>
    </div>
  )
}
