import type { AgentWorkspaceView } from './types'

export const TARGET_SAMPLE_RATE = 16000
export const DEFAULT_LANGUAGE = 'zh-en'
export const NAV_ITEMS = [
  { label: '当前任务', href: '#workspace', meta: 'Workspace' },
  { label: '组件清单', href: '#bom', meta: 'Components' },
  { label: '结果预览', href: '#model', meta: 'Preview' },
  { label: '仿真工具', href: '#tools', meta: 'Tools' },
  { label: '工作区文件', href: '#log', meta: 'Files' },
]
export const NAV_VIEWS: AgentWorkspaceView[] = ['workspace', 'bom', 'model', 'tools', 'log']
export const WORKSPACE_GEOMETRY_AFTER_GLB_PATH = '01_cad/geometry_after.glb'
export const CONVERSATION_HISTORY_RELATIVE_PATH = 'logs/conversation-history.json'
export const CONVERSATION_PREVIEW_SESSION_LIMIT = 3
export const CONVERSATION_PREVIEW_TURN_LIMIT = 12
export const CONVERSATION_PREVIEW_EVENT_LIMIT = 80
export const NOVNC_URL_PARAMS = 'vnc.html?autoconnect=true&resize=scale&path=websockify'
export const AGENT_HOME_PATH = '/agent'
