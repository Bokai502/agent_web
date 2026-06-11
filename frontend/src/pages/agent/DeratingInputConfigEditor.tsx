import { useCallback, useEffect, useMemo, useState } from 'react'
import '../../../gnc_config/gnc_config.css'
import {
  fetchDeratingInputConfig,
  saveDeratingInputConfig,
  type DeratingImportBaselineGroup,
  type DeratingInputConfig,
  type DeratingOption,
  type DeratingWorkspaceContext,
} from './deratingInputConfigApi'

type DeratingInputConfigEditorProps = {
  activeContext: DeratingWorkspaceContext
}

function cloneConfig(config: DeratingInputConfig): DeratingInputConfig {
  return JSON.parse(JSON.stringify(config)) as DeratingInputConfig
}

function normalizeOptions(options: unknown): DeratingOption[] {
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
      } as DeratingOption
    })
    .filter((option): option is DeratingOption => !!option)
}

function getQualityOptions(config: DeratingInputConfig) {
  return normalizeOptions(config.quality_level?.options ?? config.quality_compare_baseline_options?.domesticQualityOptions)
}

function getImportBaselineGroups(config: DeratingInputConfig) {
  return Array.isArray(config.quality_compare_baseline_options?.importBaselineOptions)
    ? config.quality_compare_baseline_options.importBaselineOptions
    : []
}

function getSelectedBaselineGroup(config: DeratingInputConfig, groups: DeratingImportBaselineGroup[]) {
  const selected = config.quality_level?.selected_import_baseline_group
  return groups.find(group => group.group.value === selected) ?? groups[0] ?? null
}

function updateInputFile(config: DeratingInputConfig, key: string, filename: string, options: DeratingOption[]) {
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

function updateQuality(config: DeratingInputConfig, selected: string) {
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

function updateBaselineGroup(config: DeratingInputConfig, group: DeratingImportBaselineGroup) {
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

function updateBaselineField(config: DeratingInputConfig, fieldKey: string, value: string) {
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

function normalizeSelectedBaseline(config: DeratingInputConfig) {
  const groups = getImportBaselineGroups(config)
  const selected = config.quality_level?.selected_import_baseline
  if (selected) {
    return updateBaselineGroup(config, selected)
  }
  return groups[0] ? updateBaselineGroup(config, groups[0]) : config
}

function EditorCard({ children, subtitle, title }: { children: React.ReactNode; subtitle: string; title: string }) {
  return (
    <section className="gnc-editor-card">
      <div className="gnc-editor-card-head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {children}
    </section>
  )
}

export function DeratingInputConfigEditor({ activeContext }: DeratingInputConfigEditorProps) {
  const [config, setConfig] = useState<DeratingInputConfig | null>(null)
  const [configPath, setConfigPath] = useState('')
  const [inputFileOptions, setInputFileOptions] = useState<DeratingOption[]>([])
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

  const loadConfig = useCallback(async () => {
    setStatus('正在读取 workspaceDir/00_inputs/input_config.json')
    const payload = await fetchDeratingInputConfig(workspaceContext)
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
      const payload = await saveDeratingInputConfig(workspaceContext, config)
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
      <div className="gnc-editor-shell">
        <div className="gnc-editor-empty">{status}</div>
      </div>
    )
  }

  return (
    <div className="gnc-editor-shell derating-editor-shell">
      <div className="gnc-editor-top">
        <div>
          <span>INPUT CONFIG</span>
          <small>{configPath || 'workspaceDir/00_inputs/input_config.json'}</small>
        </div>
        <div className="gnc-editor-actions">
          <button type="button" disabled={saving} onClick={() => loadConfig().catch(error => setStatus(error instanceof Error ? error.message : '读取失败'))}>Reload</button>
          <button type="button" className="primary" disabled={saving} onClick={() => saveConfig()}>{saving ? 'Saving' : 'Save'}</button>
        </div>
      </div>
      <div className="gnc-editor-status">{status}</div>

      <div className="gnc-editor-grid">
        <EditorCard title="Input Files" subtitle="Options are read from current workspaceDir/00_inputs">
          <div className="gnc-form-grid">
            {inputFileEntries.map(([key, value]) => (
              <label key={key} className="gnc-editor-field">
                <span>{value.description || key}</span>
                <select
                  value={value.relative_path ?? ''}
                  onChange={event => setConfig(updateInputFile(config, key, event.target.value, inputFileOptions))}
                >
                  <option value="">未选择</option>
                  {inputFileOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </EditorCard>

        <EditorCard title="Domestic Quality Level" subtitle="quality_level from input_config.json">
          <div className="gnc-form-grid">
            <label className="gnc-editor-field wide">
              <span>Quality Level</span>
              <select
                value={config.quality_level?.selected ?? ''}
                onChange={event => setConfig(updateQuality(config, event.target.value))}
              >
                {qualityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </EditorCard>

        <EditorCard title="Import Baseline Group" subtitle="selected_import_baseline in quality_level">
          <div className="gnc-form-grid">
            <label className="gnc-editor-field wide">
              <span>Baseline Group</span>
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
          </div>
        </EditorCard>

        <EditorCard title="Import Quality Rules" subtitle="Four imported quality selections for the selected group">
          <div className="gnc-form-grid">
            {(displayedBaseline?.fields ?? []).map(field => (
              <label key={field.key} className="gnc-editor-field">
                <span>{field.label}</span>
                <select
                  value={field.selected ?? field.options[0]?.value ?? ''}
                  onChange={event => setConfig(updateBaselineField(config, field.key, event.target.value))}
                >
                  {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </EditorCard>
      </div>
    </div>
  )
}
