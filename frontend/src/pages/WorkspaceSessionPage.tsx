import { useCallback, useEffect, useMemo, useState } from "react"
import { AppleTaskComposer } from "../components/AppleTaskComposer"
import { APP_NAVIGATION_EVENT, formatSessionTime } from "../app/sessionUtils"
import { createImageUrl } from "../components/bomData"
import { MarkdownText } from "../components/outputMarkdown"
import { useBomInfo } from "../hooks/useBomInfo"
import { useWorkspaceAppState } from "../hooks/useWorkspaceAppState"
import type { CodexInputItem, Session, ThreadEvent, Turn } from "../types"

const WORKSPACE_HOME_PATH = "/workspace"

type ViewerComponentMessage = {
  componentId?: unknown
  type?: unknown
}

type FreecadProgressResponse = {
  exists?: boolean
  data?: unknown
  source_path?: string | null
  source_version?: string | null
  updated_at?: string | null
}

type FreecadWorkspaceItem = {
  missing?: string[]
  name: string
  path: string
  valid: boolean
}

type FreecadWorkspacesResponse = {
  current?: string | null
  currentName?: string | null
  effective?: string | null
  envOverride?: boolean
  items?: FreecadWorkspaceItem[]
  root?: string
}

type WorkspaceSessionGroup = FreecadWorkspaceItem & {
  sessions: Session[]
}

const UNASSIGNED_WORKSPACE_NAME = "__unassigned__"

type ProgressEntry = {
  fileNames: string[]
  key: string
  label: string
  percent: number
}

const WORKFLOW_PROGRESS_STAGES: ProgressEntry[] = [
  { fileNames: [], key: "layout", label: "布局生成", percent: 0 },
  { fileNames: [], key: "modeling", label: "几何建模", percent: 0 },
  { fileNames: [], key: "export_file_percent", label: "文件导出", percent: 0 },
  { fileNames: [], key: "case_build", label: "算例构建", percent: 0 },
  { fileNames: [], key: "simulation_run", label: "仿真运行", percent: 0 },
  { fileNames: [], key: "field_export", label: "场数据导出", percent: 0 },
  { fileNames: [], key: "analysis", label: "结果分析", percent: 0 },
  { fileNames: [], key: "suggestion", label: "优化建议", percent: 0 },
]

type ActivePanel = "bom" | "log" | "model" | "freecad" | "paraview" | "comsol"

const STYLE = `
.workspace-apple {
  min-height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 52% 0%, rgba(120, 177, 255, 0.18), transparent 34%),
    linear-gradient(180deg, #fbfbfd 0%, #f5f5f7 46%, #f1f1f3 100%);
  color: #1d1d1f;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
}
.workspace-apple button,
.workspace-apple textarea { font: inherit; }
.wa-topbar {
  position: relative;
  z-index: 100;
  height: 52px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  background: rgba(251, 251, 253, 0.78);
  backdrop-filter: blur(24px) saturate(180%);
}
.wa-topbar-inner {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: space-between;
}
.wa-nav-left {
  display: inline-flex;
  align-items: center;
  gap: 14px;
}
.wa-back-button {
  display: inline-flex;
  height: 36px;
  align-items: center;
  gap: 9px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82), 0 8px 20px rgba(0, 0, 0, 0.06);
  color: #3f3f44;
  cursor: pointer;
  padding: 0 13px 0 8px;
  font-size: 12px;
  font-weight: 700;
}
.wa-back-button:hover { background: rgba(255, 255, 255, 0.9); color: #1d1d1f; }
.wa-back-button span:first-child {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 50%;
  background: #1d1d1f;
  color: white;
  font-size: 15px;
  line-height: 1;
}
.wa-history-menu {
  position: relative;
}
.wa-history-button {
  display: inline-flex;
  height: 36px;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82), 0 8px 20px rgba(0, 0, 0, 0.06);
  color: #3f3f44;
  cursor: pointer;
  padding: 0 13px;
  font-size: 12px;
  font-weight: 700;
}
.wa-history-button:hover { background: rgba(255, 255, 255, 0.9); color: #1d1d1f; }
.wa-history-dropdown {
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  z-index: 240;
  width: min(360px, calc(100vw - 28px));
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.16);
  backdrop-filter: blur(24px) saturate(180%);
  padding: 8px;
}
.wa-history-item {
  display: block;
  width: 100%;
  min-height: 54px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  padding: 9px 10px;
  text-align: left;
  cursor: pointer;
}
.wa-history-item:hover,
.wa-history-item.active { background: rgba(0, 0, 0, 0.05); }
.wa-history-item strong {
  display: block;
  overflow: hidden;
  color: #1d1d1f;
  font-size: 12.5px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-history-item span {
  display: block;
  margin-top: 4px;
  color: #86868b;
  font-size: 11px;
  font-weight: 650;
}
.wa-history-more {
  width: 100%;
  height: 32px;
  margin-top: 4px;
  border: 0;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.045);
  color: #55555a;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}
.wa-workspace-menu {
  position: relative;
}
.wa-workspace-button {
  display: inline-flex;
  height: 36px;
  max-width: 220px;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82), 0 8px 20px rgba(0, 0, 0, 0.06);
  color: #3f3f44;
  cursor: pointer;
  padding: 0 13px;
  font-size: 12px;
  font-weight: 700;
}
.wa-workspace-button:hover { background: rgba(255, 255, 255, 0.9); color: #1d1d1f; }
.wa-workspace-button span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-workspace-dropdown {
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  z-index: 240;
  display: grid;
  grid-template-columns: 240px minmax(260px, 360px);
  gap: 8px;
  width: min(620px, calc(100vw - 28px));
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.16);
  backdrop-filter: blur(24px) saturate(180%);
  padding: 8px;
}
.wa-workspace-list,
.wa-workspace-history {
  min-width: 0;
}
.wa-workspace-history {
  border-left: 1px solid rgba(0, 0, 0, 0.07);
  padding-left: 8px;
}
.wa-workspace-item {
  display: block;
  width: 100%;
  min-height: 46px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
}
.wa-workspace-item:hover,
.wa-workspace-item.active { background: rgba(0, 0, 0, 0.05); }
.wa-workspace-item:disabled { cursor: not-allowed; opacity: 0.48; }
.wa-workspace-item strong {
  display: block;
  color: #1d1d1f;
  font-size: 12.5px;
  line-height: 1.25;
}
.wa-workspace-item span {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: #86868b;
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-workspace-history-title {
  height: 28px;
  padding: 4px 10px 0;
  color: #55555a;
  font-size: 11px;
  font-weight: 800;
}
.wa-workspace-session {
  display: block;
  width: 100%;
  min-height: 50px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
}
.wa-workspace-session:hover,
.wa-workspace-session.active { background: rgba(0, 0, 0, 0.05); }
.wa-workspace-session strong {
  display: block;
  overflow: hidden;
  color: #1d1d1f;
  font-size: 12.5px;
  line-height: 1.32;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-workspace-session span {
  display: block;
  margin-top: 4px;
  color: #86868b;
  font-size: 11px;
  font-weight: 650;
}
.wa-tabs {
  position: absolute;
  left: 50%;
  display: inline-flex;
  transform: translateX(-50%);
  overflow: visible;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.66);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
.wa-tabs button {
  height: 34px;
  min-width: 86px;
  border: 0;
  background: transparent;
  color: #5d5d62;
  font-size: 12px;
  font-weight: 650;
}
.wa-tabs button.active { background: #1d1d1f; color: white; border-radius: 999px; }
.wa-tool-menu { position: relative; }
.wa-tool-panel {
  position: absolute;
  left: 50%;
  top: calc(100% + 8px);
  z-index: 200;
  display: none;
  min-width: 170px;
  transform: translateX(-50%);
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.14);
  backdrop-filter: blur(24px) saturate(180%);
  padding: 6px;
}
.wa-tool-menu:hover .wa-tool-panel,
.wa-tool-menu:focus-within .wa-tool-panel { display: grid; gap: 4px; }
.wa-tool-panel a,
.wa-tool-panel button {
  display: flex;
  width: 100%;
  height: 38px;
  align-items: center;
  justify-content: space-between;
  border: 0;
  border-radius: 12px;
  background: transparent;
  padding: 0 11px;
  color: #1d1d1f;
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}
.wa-tool-panel a:hover,
.wa-tool-panel button:hover { background: rgba(0, 0, 0, 0.045); }
.wa-tool-panel span { color: #8d8d92; font-size: 11px; }
.wa-status-pill {
  display: inline-flex;
  height: 34px;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  padding: 0 13px;
  color: #56565b;
  font-size: 12px;
  font-weight: 650;
}
button.wa-status-pill {
  font-family: inherit;
}
button.wa-status-pill:not(:disabled) { cursor: pointer; }
button.wa-status-pill:not(:disabled):hover { background: rgba(255, 255, 255, 0.92); }
button.wa-status-pill:disabled { cursor: default; opacity: 0.72; }
.wa-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #0f7f56; }
.wa-workspace {
  display: grid;
  grid-template-columns: clamp(310px, 24vw, 390px) minmax(520px, 1fr) clamp(300px, 22vw, 360px);
  gap: 10px;
  width: calc(100vw - 20px);
  height: calc(100vh - 64px);
  margin: 6px auto;
}
.wa-panel {
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(28px) saturate(180%);
}
.wa-panel-header {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  padding: 0 20px;
}
.wa-panel-title { min-width: 0; }
.wa-panel-title strong {
  display: block;
  overflow: hidden;
  color: #1d1d1f;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-panel-title span { display: block; margin-top: 3px; color: #86868b; font-size: 12px; }
.wa-chat {
  display: flex;
  min-height: 0;
  flex-direction: column;
  --bg: transparent;
  --bg-2: rgba(255, 255, 255, 0.72);
  --bg-3: rgba(0, 0, 0, 0.055);
  --border: rgba(0, 0, 0, 0.07);
  --border-2: rgba(0, 0, 0, 0.1);
  --text: #1d1d1f;
  --text-2: #5d5d62;
  --text-3: #86868b;
  --green: #0f7f56;
  --red: #d94b3d;
  --amber: #b85f00;
  --blue: #0071e3;
  --code-bg: rgba(0, 0, 0, 0.045);
  --code-header: rgba(0, 0, 0, 0.045);
  --code-text: #1d1d1f;
  --code-dim: #6e6e73;
  --content-width: 100%;
  --content-px: 18px;
}
.wa-left-stack {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) minmax(170px, 0.58fr);
  gap: 12px;
  padding: 12px;
}
.wa-left-section {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.085);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(255, 255, 255, 0.76));
  box-shadow:
    0 16px 42px rgba(0, 0, 0, 0.075),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
}
.wa-left-section::before {
  content: "";
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 4px;
  border-radius: 0 999px 999px 0;
  background: #1d1d1f;
  opacity: 0.9;
}
.wa-left-section:nth-child(2)::before { background: #0071e3; }
.wa-left-section:nth-child(3)::before { background: #0f7f56; }
.wa-left-section:nth-child(2) {
  border-color: rgba(0, 113, 227, 0.16);
  box-shadow:
    0 18px 46px rgba(0, 113, 227, 0.11),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
}
.wa-left-section:nth-child(3) {
  border-color: rgba(15, 127, 86, 0.15);
  box-shadow:
    0 18px 46px rgba(15, 127, 86, 0.09),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
}
.wa-left-section-header {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  background: rgba(255, 255, 255, 0.62);
  padding: 0 16px 0 18px;
}
.wa-left-section-header strong {
  color: #1d1d1f;
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.01em;
}
.wa-left-section-header span {
  display: block;
  margin-top: 3px;
  color: #86868b;
  font-size: 11px;
  font-weight: 700;
}
.wa-left-section-header button {
  height: 28px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: #55555a;
  cursor: pointer;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
}
.wa-left-input {
  overflow: visible;
}
.wa-left-input-body {
  padding: 12px;
}
.wa-left-pending {
  color: #b85f00;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.45;
  padding: 10px 12px;
}
.wa-agent-feed,
.wa-run-feed {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 14px;
}
.wa-agent-card,
.wa-run-card {
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.045);
  padding: 13px;
}
.wa-agent-card + .wa-agent-card,
.wa-run-card + .wa-run-card {
  margin-top: 9px;
}
.wa-agent-prompt {
  color: #55555a;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.45;
}
.wa-agent-answer {
  margin-top: 9px;
  color: #1d1d1f;
  font-size: 13px;
  line-height: 1.62;
}
.wa-agent-thinking {
  margin-top: 9px;
  border-top: 1px solid rgba(0, 0, 0, 0.055);
  color: #6e6e73;
  font-size: 12px;
  line-height: 1.55;
  padding-top: 9px;
}
.wa-ask-user {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}
.wa-ask-user button {
  min-height: 32px;
  border: 1px solid rgba(184, 95, 0, 0.22);
  border-radius: 10px;
  background: rgba(255, 247, 237, 0.82);
  color: #7c3f00;
  cursor: pointer;
  padding: 7px 9px;
  text-align: left;
  font-size: 12px;
  font-weight: 650;
}
.wa-run-card {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  width: 100%;
  text-align: left;
}
button.wa-run-card {
  cursor: pointer;
}
button.wa-run-card.selected {
  border-color: rgba(0, 113, 227, 0.28);
  background: rgba(237, 246, 255, 0.92);
  box-shadow: 0 12px 28px rgba(0, 113, 227, 0.12);
}
.wa-run-status-icon {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  color: #55555a;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
}
.wa-run-status-icon.success,
.wa-run-status-icon.completed,
.wa-run-status-icon.done { background: rgba(15, 127, 86, 0.12); color: #0f7f56; }
.wa-run-status-icon.failed,
.wa-run-status-icon.error { background: rgba(217, 75, 61, 0.12); color: #d94b3d; }
.wa-run-status-icon.running,
.wa-run-status-icon.in_progress,
.wa-run-status-icon.pending { background: rgba(184, 95, 0, 0.12); color: #b85f00; }
.wa-run-main {
  min-width: 0;
}
.wa-run-title {
  overflow: hidden;
  color: #1d1d1f;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-run-detail {
  margin-top: 3px;
  overflow: hidden;
  color: #6e6e73;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-left-empty {
  border: 1px dashed rgba(0, 0, 0, 0.11);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.54);
  color: #737378;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
  padding: 16px;
}
.wa-log {
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.wa-composer {
  flex-shrink: 0;
  overflow: visible;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  background: rgba(255, 255, 255, 0.52);
  padding: 10px 12px 12px;
  --content-width: 100%;
  --content-px: 0px;
}
.wa-stage { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
.wa-stage-body {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 20%, rgba(140, 184, 255, 0.24), transparent 26%),
    linear-gradient(180deg, #f8f8fb 0%, #eceff4 100%);
}
.wa-viewer {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}
.wa-stage-empty {
  display: grid;
  min-height: 100%;
  place-items: center;
  padding: 24px;
  text-align: center;
}
.wa-stage-empty-inner {
  max-width: 340px;
}
.wa-stage-empty-inner strong {
  display: block;
  color: #1d1d1f;
  font-size: 20px;
  line-height: 1.2;
}
.wa-stage-empty-inner span {
  display: block;
  margin-top: 10px;
  color: #6e6e73;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.55;
}
.wa-bom-stage {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 72px 24px 24px;
}
.wa-bom-stage-inner {
  max-width: 980px;
  margin: 0 auto;
}
.wa-bom-stage h2 {
  margin: 0;
  font-size: 42px;
  line-height: 1.05;
}
.wa-bom-stage p {
  margin: 10px 0 0;
  color: #6e6e73;
  font-size: 15px;
  line-height: 1.5;
}
.wa-bom-stage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 24px;
}
.wa-bom-detail {
  display: grid;
  grid-template-columns: minmax(240px, 360px) minmax(0, 1fr);
  gap: 16px;
  margin-top: 24px;
}
.wa-bom-detail-card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.72);
  padding: 18px;
}
.wa-bom-detail-card img {
  display: block;
  max-width: 100%;
  max-height: 220px;
  margin: 0 auto;
  object-fit: contain;
}
.wa-bom-detail-card h3 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}
.wa-bom-detail-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.wa-bom-field {
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.035);
  padding: 11px 12px;
}
.wa-bom-field span {
  display: block;
  color: #86868b;
  font-size: 11px;
  font-weight: 650;
}
.wa-bom-field strong {
  display: block;
  margin-top: 4px;
  color: #1d1d1f;
  font-size: 13px;
  line-height: 1.35;
}
.wa-bom-stage-grid button {
  min-height: 96px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.72);
  padding: 15px;
  text-align: left;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.05);
}
.wa-bom-stage-grid button.selected {
  border-color: rgba(0, 113, 227, 0.32);
  box-shadow: 0 18px 44px rgba(0, 113, 227, 0.12);
}
.wa-bom-stage-grid strong {
  display: block;
  margin-top: 8px;
  color: #1d1d1f;
  font-size: 14px;
}
.wa-bom-stage-grid small {
  display: block;
  margin-top: 5px;
  color: #86868b;
  font-size: 12px;
}
.wa-log-stage {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 72px 24px 24px;
}
.wa-log-stage-inner {
  max-width: 940px;
  margin: 0 auto;
}
.wa-log-stage h2 {
  margin: 0;
  font-size: 42px;
  line-height: 1.05;
}
.wa-log-stage p {
  margin: 10px 0 0;
  color: #6e6e73;
  font-size: 15px;
  line-height: 1.5;
}
.wa-log-detail-card {
  margin-top: 24px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.72);
  padding: 18px;
}
.wa-log-detail-card h3 {
  margin: 0;
  color: #1d1d1f;
  font-size: 24px;
  line-height: 1.2;
}
.wa-log-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.wa-log-detail-field {
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.035);
  padding: 11px 12px;
}
.wa-log-detail-field span {
  display: block;
  color: #86868b;
  font-size: 11px;
  font-weight: 650;
}
.wa-log-detail-field strong {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: #1d1d1f;
  font-size: 13px;
  line-height: 1.35;
}
.wa-log-raw {
  max-height: 320px;
  overflow: auto;
  margin: 16px 0 0;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.055);
  padding: 14px;
  color: #1d1d1f;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.wa-stage-toolbar {
  position: absolute;
  right: 18px;
  top: 18px;
  z-index: 2;
}
.wa-stage-footer {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  background: rgba(0, 0, 0, 0.06);
}
.wa-stage-footer div { min-height: 82px; background: rgba(255, 255, 255, 0.68); padding: 16px 18px; }
.wa-stage-footer strong { display: block; font-size: 22px; line-height: 1; }
.wa-stage-footer span { display: block; margin-top: 8px; color: #6e6e73; font-size: 12px; font-weight: 600; }
.wa-inspector { display: flex; min-height: 0; flex-direction: column; }
.wa-inspector-content { min-height: 0; overflow-y: auto; padding: 16px; }
.wa-info-card {
  margin-bottom: 14px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.66);
  padding: 16px;
}
.wa-info-card h3 { margin: 0; font-size: 16px; line-height: 1.2; }
.wa-info-card p { margin: 9px 0 0; color: #6e6e73; font-size: 13px; line-height: 1.5; }
.wa-progress { display: grid; gap: 10px; margin-top: 14px; }
.wa-progress-item {
  display: grid;
  grid-template-columns: 76px 1fr auto;
  align-items: center;
  gap: 10px;
  color: #5d5d62;
  font-size: 12px;
  font-weight: 650;
}
.wa-progress-files {
  grid-column: 2 / 4;
  margin-top: -4px;
  overflow: hidden;
  color: #8d8d92;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-bar { height: 8px; overflow: hidden; border-radius: 999px; background: rgba(0, 0, 0, 0.06); }
.wa-bar span { display: block; height: 100%; border-radius: inherit; background: #1d1d1f; }
.wa-files, .wa-bom-list { display: grid; gap: 9px; margin-top: 14px; }
.wa-file, .wa-bom-row {
  display: block;
  gap: 8px;
  align-items: center;
  min-height: 44px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.035);
  padding: 7px 8px;
  color: #55555a;
  font-size: 12px;
  font-weight: 650;
  text-align: left;
}
.wa-bom-row.selected {
  border: 1px solid rgba(0, 113, 227, 0.32);
  background: rgba(0, 113, 227, 0.08);
  box-shadow: 0 10px 26px rgba(0, 113, 227, 0.1);
}
.wa-file small, .wa-bom-row small { color: #8d8d92; font-size: 11px; }
.wa-bom-row-top {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
}
.wa-bom-row strong {
  display: block;
  overflow: hidden;
  color: #1d1d1f;
  font-size: 12px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-bom-id { color: #55555a; font: 700 11px/1 "SF Mono", Consolas, monospace; }
@media (max-width: 1100px) {
  .workspace-apple { overflow: auto; }
  .wa-tabs { display: none; }
  .wa-workspace {
    grid-template-columns: 1fr;
    width: min(100vw - 20px, 760px);
    height: auto;
    padding-bottom: 20px;
  }
  .wa-panel { min-height: 420px; }
  .wa-stage-body { min-height: 520px; }
  .wa-bom-detail { grid-template-columns: 1fr; }
}
`

function getFileNames(turns: ReturnType<typeof useWorkspaceAppState>["turns"], currentEvents: ReturnType<typeof useWorkspaceAppState>["currentEvents"]) {
  const names = new Set<string>()
  const allEvents = [...turns.flatMap(turn => turn.events), ...currentEvents]
  for (const event of allEvents) {
    if (event.type !== "item.completed" || event.item.type !== "file_change") continue
    for (const change of event.item.changes) names.add(change.path)
  }
  return [...names].slice(0, 5)
}

function formatBomValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-"
  if (Array.isArray(value)) return value.length > 0 ? value.join(" x ") : "-"
  return String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function progressLabel(key: string) {
  const normalized = key.toLowerCase().replace(/[\s_-]+/gu, "")
  const labels: Record<string, string> = {
    layoutcompletionpercent: "布局完成",
    layout: "布局",
    layoutpercent: "布局",
    topology: "拓扑",
    bom: "BOM",
    geometry: "几何",
    modeling: "建模",
    modelingpercent: "建模",
    model: "建模",
    build: "建模",
    assembly: "装配",
    replacement: "替换",
    export: "导出",
    exportfilepercent: "文件导出",
    exportpercent: "导出",
    glb: "GLB",
    step: "STEP",
    preview: "预览",
    simulation: "仿真",
    analysis: "分析",
  }
  return labels[normalized] ?? key
}

function normalizeProgressKey(key: string) {
  const normalized = key.toLowerCase().replace(/[\s_-]+/gu, "")
  const aliases: Record<string, string> = {
    layoutcompletionpercent: "layout",
    layoutpercent: "layout",
    layoutgenerate: "layout",
    layoutgeneratebom: "layout",
    modeling: "modeling",
    modelingpercent: "modeling",
    model: "modeling",
    geometry: "modeling",
    geometryedit: "modeling",
    geometryvalidate: "modeling",
    export: "export_file_percent",
    exportfilepercent: "export_file_percent",
    exportpercent: "export_file_percent",
    casebuild: "case_build",
    simulation: "simulation_run",
    simulationrun: "simulation_run",
    fieldexport: "field_export",
    analysis: "analysis",
    suggestion: "suggestion",
  }
  return aliases[normalized] ?? key
}

function getWorkflowProgressEntries(progressEntries: ProgressEntry[]) {
  const progressByKey = new Map(progressEntries.map(entry => [normalizeProgressKey(entry.key), entry]))
  return WORKFLOW_PROGRESS_STAGES.map(stage => {
    const progress = progressByKey.get(stage.key)
    return progress ? { ...stage, fileNames: progress.fileNames, percent: progress.percent } : stage
  })
}

function getDisplayFileName(pathValue: string) {
  const normalized = pathValue.replace(/\\/gu, "/")
  return normalized.split("/").pop() || pathValue
}

function isGlbFilePath(pathValue: string) {
  return /\.glb$/iu.test(pathValue.trim())
}

function getViewerGlbPath(filePaths: string[]) {
  return filePaths.find(isGlbFilePath) ?? null
}

function normalizePercent(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const percent = value <= 1 && value >= 0 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(percent)))
}

function getProgressEntries(data: unknown): ProgressEntry[] {
  const progressData = isRecord(data) && isRecord(data.progress_percentages)
    ? data.progress_percentages
    : isRecord(data) && isRecord(data.progress)
      ? data.progress
      : data
  const entries: ProgressEntry[] = []
  const outputFilesByKey = getProgressOutputFilesByKey(data)

  if (Array.isArray(progressData)) {
    progressData.forEach((item, index) => {
      if (!isRecord(item)) return
      const key = typeof item.key === "string"
        ? item.key
        : typeof item.name === "string"
          ? item.name
          : typeof item.label === "string"
            ? item.label
            : `step_${index + 1}`
      const value = item.percent ?? item.percentage ?? item.progress ?? item.value
      const percent = normalizePercent(value)
      if (percent === null) return
      entries.push({
        fileNames: outputFilesByKey.get(key) ?? [],
        key,
        label: typeof item.label === "string" ? item.label : progressLabel(key),
        percent,
      })
    })
    return entries
  }

  if (!isRecord(progressData)) return entries
  for (const [key, value] of Object.entries(progressData)) {
    if (["files", "key_files", "artifacts", "outputs", "output_files", "progress", "progress_percentages", "updated_at", "tool", "success"].includes(key)) continue
    const percent = normalizePercent(value)
    if (percent === null) continue
    entries.push({
      fileNames: outputFilesByKey.get(key) ?? [],
      key,
      label: progressLabel(key),
      percent,
    })
  }
  return entries
}

function getProgressOutputFilesByKey(data: unknown) {
  const files = new Map<string, string[]>()
  if (!isRecord(data) || !isRecord(data.output_files)) return files
  const showFinalOutputs = data.success === true

  for (const [key, value] of Object.entries(data.output_files)) {
    if (!showFinalOutputs && ["step", "glb", "replaced_step", "replaced_glb"].includes(key)) continue
    const names: string[] = []
    if (typeof value === "string") {
      names.push(getDisplayFileName(value))
    } else if (isRecord(value)) {
      if (value.exists !== true) continue
      const pathValue = value.path ?? value.file ?? value.name
      if (typeof pathValue === "string") names.push(getDisplayFileName(pathValue))
    }

    if (names.length === 0) continue
    files.set(key, names)
    if (key === "step" || key === "glb") {
      const exportNames = files.get("export_file_percent") ?? []
      files.set("export_file_percent", [...exportNames, ...names])
    }
  }

  return files
}

function getProgressFiles(data: unknown) {
  if (!isRecord(data)) return []
  const candidates = [data.files, data.key_files, data.artifacts, data.outputs, data.output_files]
  const paths = new Set<string>()
  const showFinalOutputs = data.success === true

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string") paths.add(item)
        if (isRecord(item)) {
          if (item.exists === false) continue
          const pathValue = item.path ?? item.file ?? item.name
          if (typeof pathValue === "string") paths.add(pathValue)
        }
      }
    } else if (isRecord(candidate)) {
      for (const [key, value] of Object.entries(candidate)) {
        if (!showFinalOutputs && ["step", "glb", "replaced_step", "replaced_glb"].includes(key)) continue
        if (typeof value === "string") paths.add(value)
        if (isRecord(value)) {
          if (value.exists !== true) continue
          const pathValue = value.path ?? value.file ?? value.name
          if (typeof pathValue === "string") paths.add(pathValue)
        }
      }
    }
  }

  return [...paths].slice(0, 6)
}

function formatProgressUpdatedAt(progressData: FreecadProgressResponse | null) {
  const rawUpdatedAt = progressData?.updated_at ??
    (isRecord(progressData?.data) && typeof progressData.data.updated_at === "string"
      ? progressData.data.updated_at
      : null)
  if (!rawUpdatedAt) return "等待更新"

  const parsed = new Date(rawUpdatedAt)
  if (Number.isNaN(parsed.getTime())) return rawUpdatedAt
  return parsed.toLocaleString()
}

type AgentSummary = {
  answer: string
  id: string
  prompt: string
  reasoning: string
}

type RunLogEntry = {
  detail: string
  fields?: Record<string, string>
  id: string
  raw?: unknown
  source?: string
  status: string
  title: string
  type: string
  time?: string
}

type StageLogEntry = {
  detail?: string
  fields?: Record<string, string>
  id: string
  raw?: unknown
  source?: string
  status: string
  stage_name: string
  time: string
}

function getLatestItemText(events: ThreadEvent[], itemType: "agent_message" | "reasoning") {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      (event.type === "item.completed" || event.type === "item.updated" || event.type === "item.started") &&
      event.item.type === itemType &&
      event.item.text.trim()
    ) {
      return event.item.text.trim()
    }
  }
  return ""
}

function buildAgentSummaries(turns: Turn[], currentPrompt: string, currentEvents: ThreadEvent[]): AgentSummary[] {
  const summaries = turns.map(turn => ({
    answer: getLatestItemText(turn.events, "agent_message"),
    id: turn.id,
    prompt: turn.userPrompt,
    reasoning: getLatestItemText(turn.events, "reasoning"),
  }))

  if (currentPrompt || currentEvents.length > 0) {
    summaries.push({
      answer: getLatestItemText(currentEvents, "agent_message"),
      id: "current",
      prompt: currentPrompt,
      reasoning: getLatestItemText(currentEvents, "reasoning"),
    })
  }

  return summaries.filter(summary => summary.prompt || summary.answer || summary.reasoning)
}

function getRunLogEntries(turns: Turn[], currentEvents: ThreadEvent[]): RunLogEntry[] {
  const events = [...turns.flatMap(turn => turn.events), ...currentEvents]
  const entries: RunLogEntry[] = []

  events.forEach((event, index) => {
    if (event.type === "turn.started") {
      entries.push({ detail: "turn started", id: `turn-started-${index}`, status: "running", title: "开始运行", type: "run" })
      return
    }
    if (event.type === "turn.completed") {
      entries.push({
        detail: `input ${event.usage.input_tokens} / output ${event.usage.output_tokens}`,
        id: `turn-completed-${index}`,
        status: "completed",
        title: "运行完成",
        type: "run",
      })
      return
    }
    if (event.type === "turn.failed") {
      entries.push({ detail: event.error.message, id: `turn-failed-${index}`, status: "failed", title: "运行失败", type: "error" })
      return
    }
    if (event.type === "error") {
      entries.push({ detail: event.message, id: `error-${index}`, status: "error", title: "系统错误", type: "error" })
      return
    }
    if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") return

    const done = event.type === "item.completed"
    const item = event.item
    if (item.type === "command_execution") {
      const command = item.command.split("\n")[0] ?? item.command
      entries.push({
        detail: done ? `exit ${item.exit_code ?? "-"}` : item.status,
        fields: {
          command: item.command,
          exit_code: item.exit_code == null ? "-" : String(item.exit_code),
          output_chars: String(item.aggregated_output.length),
        },
        id: `${item.id}-${event.type}`,
        raw: {
          command: item.command,
          output: item.aggregated_output,
          status: item.status,
          exit_code: item.exit_code ?? null,
        },
        status: item.status,
        title: command,
        type: "shell",
      })
      return
    }
    if (item.type === "file_change") {
      entries.push({
        detail: item.changes.map(change => `${change.kind} ${change.path}`).join(", "),
        fields: {
          changes: String(item.changes.length),
          paths: item.changes.map(change => change.path).join(", "),
        },
        id: `${item.id}-${event.type}`,
        raw: item.changes,
        status: done ? "completed" : "running",
        title: `文件变更 ${item.changes.length} 项`,
        type: "file",
      })
      return
    }
    if (item.type === "mcp_tool_call") {
      entries.push({
        detail: `${item.server}.${item.tool} · ${item.status}`,
        fields: {
          server: item.server,
          tool: item.tool,
        },
        id: `${item.id}-${event.type}`,
        raw: {
          arguments: item.arguments,
          result: item.result ?? null,
          error: item.error ?? null,
        },
        status: item.status,
        title: "工具调用",
        type: "tool",
      })
      return
    }
    if (item.type === "web_search") {
      entries.push({ detail: item.query, id: `${item.id}-${event.type}`, status: done ? "completed" : "running", title: "网页搜索", type: "web" })
      return
    }
    if (item.type === "ask_user") {
      entries.push({ detail: item.question, id: `${item.id}-${event.type}`, status: "pending", title: "等待用户确认", type: "ask" })
    }
  })

  return entries.slice(-80).reverse()
}

function getDisplayLogEntries(stageLogs: StageLogEntry[], runEntries: RunLogEntry[]): RunLogEntry[] {
  if (stageLogs.length > 0) {
    return stageLogs.map(entry => ({
      detail: entry.detail ?? formatStageLogTime(entry.time),
      fields: entry.fields,
      id: entry.id,
      raw: entry.raw,
      source: entry.source,
      status: entry.status,
      time: entry.time,
      title: entry.stage_name,
      type: "stage",
    }))
  }
  return runEntries
}

function AgentUnderstandingPanel({
  currentEvents,
  currentPrompt,
  onSubmitAskUser,
  onStopAskUser,
  pendingAskUser,
  turns,
}: {
  currentEvents: ThreadEvent[]
  currentPrompt: string
  onSubmitAskUser: (answer: string) => void
  onStopAskUser: () => void
  pendingAskUser: ReturnType<typeof useWorkspaceAppState>["pendingAskUser"]
  turns: Turn[]
}) {
  const summaries = useMemo(() => buildAgentSummaries(turns, currentPrompt, currentEvents), [currentEvents, currentPrompt, turns])
  const visibleSummaries = summaries.slice(-1)

  return (
    <section className="wa-left-section">
      <div className="wa-left-section-header">
        <div>
          <strong>Agent 理解</strong>
          <span>{summaries.length > 0 ? `${summaries.length} 轮` : "等待对话"}</span>
        </div>
      </div>
      <div className="wa-agent-feed">
        {visibleSummaries.length === 0 ? (
          <div className="wa-left-empty">提交指令后，这里会显示 agent 对最新任务的理解和回复。</div>
        ) : visibleSummaries.map(summary => (
          <article className="wa-agent-card" key={summary.id}>
            {summary.prompt && <div className="wa-agent-prompt">用户指令：{summary.prompt}</div>}
            {summary.answer ? (
              <div className="wa-agent-answer"><MarkdownText text={summary.answer} /></div>
            ) : (
              <div className="wa-agent-answer">正在理解并生成结果...</div>
            )}
            {summary.reasoning && (
              <details className="wa-agent-thinking">
                <summary>查看推理过程</summary>
                <MarkdownText text={summary.reasoning} tone="muted" />
              </details>
            )}
          </article>
        ))}
        {pendingAskUser && (
          <article className="wa-agent-card">
            <div className="wa-agent-prompt">需要确认：{pendingAskUser.question}</div>
            <div className="wa-ask-user">
              {pendingAskUser.options.map(option => (
                <button type="button" key={option} onClick={() => onSubmitAskUser(option)}>{option}</button>
              ))}
              <button type="button" onClick={onStopAskUser}>停止对话</button>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}

function getStatusIcon(status: string) {
  const normalized = status.toLowerCase()
  if (["success", "completed", "complete", "done", "passed", "ok"].includes(normalized)) return "✓"
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(normalized)) return "!"
  if (["running", "in_progress", "pending", "started", "processing"].includes(normalized)) return "…"
  return "•"
}

function formatStageLogTime(time: string) {
  if (!time) return "-"
  const parsed = new Date(time)
  if (Number.isNaN(parsed.getTime())) return time
  return parsed.toLocaleString()
}

function RunLogPanel({
  entries,
  onSelect,
  selectedLogId,
}: {
  entries: RunLogEntry[]
  onSelect: (entry: RunLogEntry) => void
  selectedLogId: string
}) {
  return (
    <section className="wa-left-section">
      <div className="wa-left-section-header">
        <div>
          <strong>系统日志</strong>
          <span>{entries.length > 0 ? `${entries.length} 条` : "暂无 runs"}</span>
        </div>
      </div>
      <div className="wa-run-feed">
        {entries.length === 0 ? (
          <div className="wa-left-empty">工作目录 logs 中的 JSON 阶段日志会显示在这里。</div>
        ) : (
          entries.map(entry => (
            <button
              type="button"
              className={`wa-run-card${entry.id === selectedLogId ? " selected" : ""}`}
              key={entry.id}
              onClick={() => onSelect(entry)}
            >
              <span className={`wa-run-status-icon ${entry.status.toLowerCase()}`} title={entry.status}>
                {getStatusIcon(entry.status)}
              </span>
              <div className="wa-run-main">
                <div className="wa-run-title" title={entry.title}>{entry.title}</div>
                <div className="wa-run-detail" title={entry.detail}>{entry.detail}</div>
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  )
}

interface WorkspaceSessionPageProps {
  homePath?: string
}

interface WorkspaceAppleContentProps {
  state: ReturnType<typeof useWorkspaceAppState>
}

export function WorkspaceAppleContent({ state }: WorkspaceAppleContentProps) {
  const {
    activeSessionId,
    currentEvents,
    currentPrompt,
    handleDelete: _handleDelete,
    handleAssignSessionWorkspace,
    handleNew,
    handleSelect,
    handleStopAskUser,
    handleSubmit,
    isMobile: _isMobile,
    pendingAskUser,
    running,
    sortedSessions,
    turns,
    abort,
  } = state
  const [workspaceRefreshNonce, setWorkspaceRefreshNonce] = useState(0)
  const { bomInfo, loading: bomLoading } = useBomInfo(workspaceRefreshNonce)
  const [selectedBomId, setSelectedBomId] = useState("")
  const [activePanel, setActivePanel] = useState<ActivePanel>("model")
  const [progressData, setProgressData] = useState<FreecadProgressResponse | null>(null)
  const [progressRefreshNonce, setProgressRefreshNonce] = useState(0)
  const [selectedLogId, setSelectedLogId] = useState("")
  const [stageLogs, setStageLogs] = useState<StageLogEntry[]>([])
  const [workspaces, setWorkspaces] = useState<FreecadWorkspacesResponse | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspaceChanging, setWorkspaceChanging] = useState(false)
  const [hoveredWorkspaceName, setHoveredWorkspaceName] = useState<string | null>(null)

  const activeSession = sortedSessions.find(session => session.id === activeSessionId)
  const workspaceItems = workspaces?.items ?? []
  const currentWorkspaceName = workspaces?.currentName ?? workspaces?.effective?.split(/[\\/]/u).pop() ?? "未选择"
  const currentWorkspaceDir = workspaces?.current ?? workspaces?.effective ?? null
  const unassignedWorkspaceItem = useMemo<FreecadWorkspaceItem>(() => ({
    missing: [],
    name: UNASSIGNED_WORKSPACE_NAME,
    path: currentWorkspaceDir ?? "",
    valid: true,
  }), [currentWorkspaceDir])
  const menuWorkspaceItems = useMemo(() => {
    const unassignedCount = sortedSessions.filter(session => !session.workspaceName && !session.workspaceDir).length
    return unassignedCount > 0 ? [...workspaceItems, unassignedWorkspaceItem] : workspaceItems
  }, [sortedSessions, unassignedWorkspaceItem, workspaceItems])
  const hoveredWorkspace = menuWorkspaceItems.find(item => item.name === hoveredWorkspaceName) ??
    menuWorkspaceItems.find(item => item.name === currentWorkspaceName) ??
    menuWorkspaceItems[0] ??
    null
  const getWorkspaceSessionCount = useCallback((workspace: FreecadWorkspaceItem) => {
    return sortedSessions.filter(session => {
      if (workspace.name === UNASSIGNED_WORKSPACE_NAME) return !session.workspaceName && !session.workspaceDir
      if (session.workspaceDir && workspace.path) return session.workspaceDir === workspace.path
      return session.workspaceName === workspace.name
    }).length
  }, [sortedSessions])
  const sessionsByWorkspace = useMemo<WorkspaceSessionGroup[]>(() => menuWorkspaceItems.map(item => ({
    ...item,
    sessions: sortedSessions.filter(session => {
      if (item.name === UNASSIGNED_WORKSPACE_NAME) return !session.workspaceName && !session.workspaceDir
      if (session.workspaceDir && item.path) return session.workspaceDir === item.path
      return session.workspaceName === item.name
    }),
  })), [menuWorkspaceItems, sortedSessions])
  const hoveredWorkspaceSessions = sessionsByWorkspace.find(item => item.name === hoveredWorkspace?.name)?.sessions ?? []
  const selectedBom = bomInfo.components.find(component => component.componentId === selectedBomId) ?? bomInfo.components[0]
  const fileNames = useMemo(() => getFileNames(turns, currentEvents), [turns, currentEvents])
  const progressEntries = useMemo(() => getProgressEntries(progressData?.data), [progressData])
  const workflowProgressEntries = useMemo(() => getWorkflowProgressEntries(progressEntries), [progressEntries])
  const progressFiles = useMemo(() => getProgressFiles(progressData?.data), [progressData])
  const runLogEntries = useMemo(() => getRunLogEntries(turns, currentEvents), [currentEvents, turns])
  const logEntries = useMemo(() => getDisplayLogEntries(stageLogs, runLogEntries), [runLogEntries, stageLogs])
  const selectedLog = logEntries.find(entry => entry.id === selectedLogId) ?? logEntries[0] ?? null
  const displayedFileNames = progressFiles.length > 0 ? progressFiles : fileNames
  const previewGlbPath = useMemo(() => getViewerGlbPath(displayedFileNames), [displayedFileNames])
  const viewerHref = useMemo(() => {
    const params = new URLSearchParams()
    if (activeSessionId) params.set("sessionId", activeSessionId)
    if (previewGlbPath) params.set("glbPath", previewGlbPath)
    if (workspaceRefreshNonce > 0) params.set("workspaceVersion", String(workspaceRefreshNonce))
    const query = params.toString()
    return query ? `/viewer?${query}` : "/viewer"
  }, [activeSessionId, previewGlbPath, workspaceRefreshNonce])
  const freecadHref = "http://10.110.10.11:7080/vnc.html?autoconnect=true&resize=scale&path=websockify"
  const paraviewHref = "http://10.110.10.11:6081/vnc.html?autoconnect=true&resize=scale&path=websockify"
  const comsolHref = "http://10.110.10.11:6082/vnc.html?autoconnect=true&resize=scale&path=websockify"
  const activeTool = activePanel === "freecad"
    ? { label: "FreeCAD", subtitle: "远程 FreeCAD 会话", title: "FreeCAD 工作台", url: freecadHref }
    : activePanel === "paraview"
      ? { label: "ParaView", subtitle: "远程 ParaView 会话", title: "ParaView 工作台", url: paraviewHref }
      : activePanel === "comsol"
        ? { label: "COMSOL", subtitle: "远程 COMSOL 会话", title: "COMSOL 工作台", url: comsolHref }
        : null
  const orderedBomComponents = useMemo(() => {
    if (!selectedBomId) return bomInfo.components
    return [...bomInfo.components].sort((left, right) => {
      if (left.componentId === selectedBomId) return -1
      if (right.componentId === selectedBomId) return 1
      return 0
    })
  }, [bomInfo.components, selectedBomId])

  const submitAndRefreshProgress = useCallback((input: string | CodexInputItem[], enabledSkills?: string[]) => {
    setProgressData(null)
    setProgressRefreshNonce(value => value + 1)
    handleSubmit(input, enabledSkills, {
      workspaceDir: currentWorkspaceDir,
      workspaceName: currentWorkspaceName,
    })
    window.setTimeout(() => setProgressRefreshNonce(value => value + 1), 150)
  }, [currentWorkspaceDir, currentWorkspaceName, handleSubmit])

  const handleSelectLog = useCallback((entry: RunLogEntry) => {
    setSelectedLogId(entry.id)
    setActivePanel("log")
  }, [])

  const handleReturnHome = useCallback(() => {
    window.history.pushState(null, "", "/home")
    window.dispatchEvent(new Event(APP_NAVIGATION_EVENT))
  }, [])

  const refreshWorkspaceViews = useCallback(() => {
    setSelectedBomId("")
    setSelectedLogId("")
    setProgressData(null)
    setWorkspaceRefreshNonce(value => value + 1)
    setProgressRefreshNonce(value => value + 1)
  }, [])

  const switchWorkspace = useCallback((name: string) => {
    setWorkspaceChanging(true)
    return fetch("/api/freecad/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then(response => {
        if (!response.ok) throw new Error("workspace switch failed")
        return response.json() as Promise<unknown>
      })
      .then(() => {
        refreshWorkspaceViews()
      })
      .catch(() => {
        // Keep the previous workspace visible if the switch is rejected.
      })
      .finally(() => setWorkspaceChanging(false))
  }, [refreshWorkspaceViews])

  const handleSelectWorkspace = useCallback((name: string) => {
    if (name === currentWorkspaceName) {
      setHoveredWorkspaceName(name)
      return
    }

    switchWorkspace(name).then(() => {
      handleNew()
      setWorkspaceOpen(false)
    })
  }, [currentWorkspaceName, handleNew, switchWorkspace])

  const handleSelectWorkspaceHistory = useCallback((session: Session, workspace: FreecadWorkspaceItem) => {
    const targetWorkspaceName = workspace.name === UNASSIGNED_WORKSPACE_NAME ? currentWorkspaceName : workspace.name
    const targetWorkspaceDir = workspace.name === UNASSIGNED_WORKSPACE_NAME ? currentWorkspaceDir : workspace.path

    if (targetWorkspaceName && targetWorkspaceName !== "未选择") {
      handleAssignSessionWorkspace(session.id, {
        workspaceDir: targetWorkspaceDir,
        workspaceName: targetWorkspaceName,
      })
    }

    const finishSelection = () => {
      handleSelect(session.id)
      setWorkspaceOpen(false)
    }

    if (workspace.name === UNASSIGNED_WORKSPACE_NAME || targetWorkspaceName === currentWorkspaceName) {
      finishSelection()
      return
    }

    switchWorkspace(targetWorkspaceName).then(finishSelection)
  }, [currentWorkspaceDir, currentWorkspaceName, handleAssignSessionWorkspace, handleSelect, switchWorkspace])

  const openExternalWindow = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer")
  }, [])

  useEffect(() => {
    const handleViewerMessage = (event: MessageEvent<ViewerComponentMessage>) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "viewer3d:component-selected") return
      if (typeof event.data.componentId !== "string") return
      setSelectedBomId(event.data.componentId)
    }

    window.addEventListener("message", handleViewerMessage)
    return () => window.removeEventListener("message", handleViewerMessage)
  }, [])

  useEffect(() => {
    setProgressData(null)
  }, [activeSessionId])

  useEffect(() => {
    let cancelled = false
    const loadWorkspaces = () => {
      fetch("/api/freecad/workspaces", { cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<FreecadWorkspacesResponse> : null)
        .then(data => {
          if (!cancelled) setWorkspaces(data)
        })
        .catch(() => {
          if (!cancelled) setWorkspaces(null)
        })
    }

    loadWorkspaces()
    return () => {
      cancelled = true
    }
  }, [workspaceRefreshNonce])

  useEffect(() => {
    let cancelled = false

    const loadProgress = () => {
      if (!activeSessionId) {
        setProgressData(null)
        return
      }
      const query = activeSessionId
        ? `?${new URLSearchParams({ sessionId: activeSessionId }).toString()}`
        : ""
      fetch(`/api/freecad/progress${query}`, { cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<FreecadProgressResponse> : null)
        .then(data => {
          if (!cancelled) setProgressData(data)
        })
        .catch(() => {
          if (!cancelled) setProgressData(null)
        })
    }

    loadProgress()
    const intervalId = window.setInterval(loadProgress, running ? 500 : 3000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeSessionId, progressRefreshNonce, running, workspaceRefreshNonce])

  useEffect(() => {
    let cancelled = false
    const loadStageLogs = () => {
      fetch("/api/logs/stages", { cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<StageLogEntry[]> : [])
        .then(data => {
          if (!cancelled) setStageLogs(Array.isArray(data) ? data : [])
        })
        .catch(() => {
          if (!cancelled) setStageLogs([])
        })
    }

    loadStageLogs()
    const intervalId = window.setInterval(loadStageLogs, 3000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [workspaceRefreshNonce])

  useEffect(() => {
    if (selectedLogId && logEntries.some(entry => entry.id === selectedLogId)) return
    setSelectedLogId(logEntries[0]?.id ?? "")
  }, [logEntries, selectedLogId])

  const stageTitle = activePanel === "model"
    ? "3D 模型预览"
    : activePanel === "bom"
      ? "BOM 清单"
      : activePanel === "log"
        ? "系统日志"
      : activeTool?.title ?? "工具工作台"
  const stageSubtitle = activePanel === "model"
    ? activeSessionId ? "当前会话模型" : "等待会话模型"
    : activePanel === "bom"
      ? bomLoading ? "正在加载 BOM 数据" : `${bomInfo.totalRecords} 个组件`
      : activePanel === "log"
        ? selectedLog ? selectedLog.title : "等待日志"
      : activeTool?.subtitle ?? "远程工具会话"

  return (
    <div className="workspace-apple">
      <style>{STYLE}</style>
      <header className="wa-topbar">
        <div className="wa-topbar-inner">
          <div className="wa-nav-left">
            <button type="button" className="wa-back-button" aria-label="返回主页" onClick={handleReturnHome}>
              <span>‹</span>
              <span>首页</span>
            </button>
            <div className="wa-workspace-menu">
              <button
                type="button"
                className="wa-workspace-button"
                aria-expanded={workspaceOpen}
                disabled={workspaceChanging}
                onClick={() => setWorkspaceOpen(open => !open)}
                title={workspaces?.effective ?? workspaces?.current ?? undefined}
              >
                <span>工作区：{currentWorkspaceName}</span>
                <span>▾</span>
              </button>
              {workspaceOpen && (
                <div className="wa-workspace-dropdown">
                  <div className="wa-workspace-list">
                    {menuWorkspaceItems.length === 0 ? (
                      <div className="wa-left-empty">暂无可用工作区。</div>
                    ) : (
                      menuWorkspaceItems.map(item => (
                        <button
                          type="button"
                          className={`wa-workspace-item${item.name === currentWorkspaceName ? " active" : ""}`}
                          disabled={item.name !== UNASSIGNED_WORKSPACE_NAME && (!item.valid || workspaceChanging)}
                          key={item.name}
                          onClick={() => {
                            if (item.name !== UNASSIGNED_WORKSPACE_NAME) handleSelectWorkspace(item.name)
                          }}
                          onFocus={() => setHoveredWorkspaceName(item.name)}
                          onMouseEnter={() => setHoveredWorkspaceName(item.name)}
                        >
                          <strong>{item.name === UNASSIGNED_WORKSPACE_NAME ? "未归属历史" : item.name}</strong>
                          <span>{item.valid ? `${getWorkspaceSessionCount(item)} 条历史` : `缺少 ${item.missing?.join(", ") || "必要目录"}`}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="wa-workspace-history">
                    <div className="wa-workspace-history-title">
                      {hoveredWorkspace ? `${hoveredWorkspace.name === UNASSIGNED_WORKSPACE_NAME ? "未归属" : hoveredWorkspace.name} 的历史记录` : "历史记录"}
                    </div>
                    {hoveredWorkspace && hoveredWorkspaceSessions.length > 0 ? (
                      hoveredWorkspaceSessions.slice(0, 12).map(session => (
                        <button
                          type="button"
                          className={`wa-workspace-session${session.id === activeSessionId ? " active" : ""}`}
                          key={session.id}
                          onClick={() => handleSelectWorkspaceHistory(session, hoveredWorkspace)}
                        >
                          <strong>{session.turns[0]?.userPrompt || session.title || "未命名会话"}</strong>
                          <span>{formatSessionTime(session.createdAt)}</span>
                        </button>
                      ))
                    ) : (
                      <div className="wa-left-empty">暂无历史记录。</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="wa-tabs" aria-label="工作区标签">
            <button
              type="button"
              className={activePanel === "bom" ? "active" : undefined}
              onClick={() => setActivePanel("bom")}
            >
              BOM
            </button>
            <button
              type="button"
              className={activePanel === "log" ? "active" : undefined}
              onClick={() => setActivePanel("log")}
            >
              日志
            </button>
            <button
              type="button"
              className={activePanel === "model" ? "active" : undefined}
              onClick={() => setActivePanel("model")}
            >
              模型
            </button>
            <div className="wa-tool-menu">
              <button type="button">工具 ▾</button>
              <div className="wa-tool-panel" role="menu" aria-label="工具列表">
                <button
                  type="button"
                  onClick={() => setActivePanel("freecad")}
                >
                  FreeCAD <span>CAD</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel("paraview")}
                >
                  ParaView <span>VNC</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel("comsol")}
                >
                  COMSOL <span>VNC</span>
                </button>
              </div>
            </div>
          </div>
          <div className="wa-status-pill">
            <span className="wa-status-dot" />
            {running ? "运行中" : activeSession ? "已加载会话" : "等待会话"}
          </div>
        </div>
      </header>

      <main className="wa-workspace">
        <aside className="wa-panel wa-chat wa-left-stack">
          <section className="wa-left-section wa-left-input">
            <div className="wa-left-section-header">
              <div>
                <strong>用户指令</strong>
                <span>{activeSession?.title || (activeSessionId ? `会话 ${activeSessionId}` : "新任务")}</span>
              </div>
            </div>
            <div className="wa-left-input-body">
              {pendingAskUser ? (
                <div className="wa-left-pending">Agent 正在等待确认，请在中间区域处理后继续输入。</div>
              ) : (
                <AppleTaskComposer
                  compact
                  enableTools={false}
                  onSubmit={submitAndRefreshProgress}
                  onAbort={abort}
                  running={running}
                  placeholder="输入用户指令、修改要求或输入 @ 添加 Skill 或文件..."
                />
              )}
            </div>
          </section>

          <AgentUnderstandingPanel
            currentEvents={currentEvents}
            currentPrompt={currentPrompt}
            onSubmitAskUser={answer => submitAndRefreshProgress(answer)}
            onStopAskUser={handleStopAskUser}
            pendingAskUser={pendingAskUser}
            turns={turns}
          />

          <RunLogPanel entries={logEntries} onSelect={handleSelectLog} selectedLogId={selectedLogId} />
        </aside>

        <section className="wa-panel wa-stage">
          <div className="wa-panel-header">
            <div className="wa-panel-title">
              <strong>{stageTitle}</strong>
              <span>{stageSubtitle}</span>
            </div>
          </div>
          <div className="wa-stage-body">
            <div className="wa-stage-toolbar">
              <button
                type="button"
                className="wa-status-pill"
                onClick={() => {
                  if (activePanel === "model") openExternalWindow(viewerHref)
                  if (activeTool) openExternalWindow(activeTool.url)
                }}
                disabled={activePanel === "bom" || activePanel === "log" || (activePanel === "model" && !activeSessionId)}
              >
                {activePanel === "model" ? "3D Viewer" : activePanel === "bom" ? "BOM" : activePanel === "log" ? "日志" : activeTool?.label}
              </button>
            </div>
            {activePanel === "model" ? (
              activeSessionId ? (
                <iframe className="wa-viewer" title="3D 模型预览" src={viewerHref} />
              ) : (
                <div className="wa-stage-empty">
                  <div className="wa-stage-empty-inner">
                    <strong>等待生成模型</strong>
                    <span>提交左侧用户指令后，本会话生成的 3D 模型会显示在这里。</span>
                  </div>
                </div>
              )
            ) : activePanel === "bom" ? (
              <div className="wa-bom-stage">
                <div className="wa-bom-stage-inner">
                  <h2>BOM 清单</h2>
                  <p>{bomLoading ? "正在加载 BOM 数据..." : `当前 BOM 共 ${bomInfo.totalRecords} 个组件。`}</p>
                  {selectedBom ? (
                    <div className="wa-bom-detail">
                      <div className="wa-bom-detail-card">
                        {selectedBom.imageExists && selectedBom.imagePath ? (
                          <img
                            alt={selectedBom.nameCn || selectedBom.name}
                            src={createImageUrl(selectedBom.imagePath) ?? ""}
                          />
                        ) : (
                          <div className="wa-file">
                            <span>暂无组件图片</span>
                            <small>-</small>
                          </div>
                        )}
                      </div>
                      <div className="wa-bom-detail-card">
                        <h3>{selectedBom.componentId} · {selectedBom.nameCn || selectedBom.name || selectedBom.model}</h3>
                        <p>{selectedBom.description}</p>
                        <div className="wa-bom-detail-fields">
                          {[
                            ["组件编号", selectedBom.componentId],
                            ["语义名", selectedBom.semanticName],
                            ["型号", selectedBom.model],
                            ["数量", selectedBom.quantity],
                            ["分系统", selectedBom.subsystem],
                            ["类型", selectedBom.kind],
                            ["类别", selectedBom.category],
                            ["尺寸", selectedBom.dimensions || selectedBom.sizeMm],
                            ["质量", selectedBom.massKg === null ? "-" : `${selectedBom.massKg} kg`],
                            ["功耗", selectedBom.powerW === null ? "-" : `${selectedBom.powerW} W`],
                            ["材料", selectedBom.material],
                            ["安装面", selectedBom.mountFace],
                            ["来源", selectedBom.source],
                            ...Object.entries(selectedBom.thermal).map(([label, value]) => [`热参数 · ${label}`, value]),
                          ].map(([label, value]) => (
                            <div className="wa-bom-field" key={String(label)}>
                              <span>{String(label)}</span>
                              <strong>{formatBomValue(value)}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="wa-bom-stage-grid">
                      {bomInfo.components.slice(0, 12).map(component => (
                        <button
                          type="button"
                          key={component.componentId}
                          onClick={() => setSelectedBomId(component.componentId)}
                        >
                          <span className="wa-bom-id">{component.componentId}</span>
                          <strong>{component.nameCn || component.name || component.model}</strong>
                          <small>{component.subsystem || component.kind || "组件"} · x{component.quantity}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : activePanel === "log" ? (
              <div className="wa-log-stage">
                <div className="wa-log-stage-inner">
                  <h2>系统日志</h2>
                  <p>{logEntries.length > 0 ? `共 ${logEntries.length} 条日志，点击左侧日志项查看详情。` : "暂无日志数据。"}</p>
                  {selectedLog ? (
                    <div className="wa-log-detail-card">
                      <h3>{selectedLog.title}</h3>
                      <p>{selectedLog.detail}</p>
                      <div className="wa-log-detail-grid">
                        {[
                          ["状态", selectedLog.status],
                          ["类型", selectedLog.type],
                          ["时间", selectedLog.time ? formatStageLogTime(selectedLog.time) : "-"],
                          ["来源", selectedLog.source ?? "-"],
                          ["ID", selectedLog.id],
                          ...Object.entries(selectedLog.fields ?? {}),
                        ].map(([label, value]) => (
                          <div className="wa-log-detail-field" key={label}>
                            <span>{label}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                      </div>
                      {selectedLog.raw !== undefined && (
                        <pre className="wa-log-raw">{JSON.stringify(selectedLog.raw, null, 2)}</pre>
                      )}
                    </div>
                  ) : (
                    <div className="wa-log-detail-card">
                      <h3>等待日志</h3>
                      <p>工作流运行后，系统日志会显示在这里。</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <iframe
                className="wa-viewer"
                title={activeTool?.label ?? "远程工具"}
                src={activeTool?.url ?? freecadHref}
              />
            )}
          </div>
          <div className="wa-stage-footer">
            <div>
              <strong>{bomInfo.totalRecords || "-"}</strong>
              <span>BOM 组件</span>
            </div>
            <div>
              <strong>{turns.length}</strong>
              <span>历史轮次</span>
            </div>
            <div>
              <strong>{running ? "RUN" : "IDLE"}</strong>
              <span>当前状态</span>
            </div>
          </div>
        </section>

        <aside className="wa-panel wa-inspector">
          <div className="wa-panel-header">
            <div className="wa-panel-title">
              <strong>产物与 BOM</strong>
              <span>当前会话沉淀的关键输出</span>
            </div>
          </div>
          <div className="wa-inspector-content">
            <section className="wa-info-card">
              <h3>工作流进度</h3>
              <p>更新时间：{formatProgressUpdatedAt(progressData)}</p>
              <div className="wa-progress">
                {workflowProgressEntries.map(item => (
                    <div className="wa-progress-item" key={item.key}>
                      <span>{item.label}</span>
                      <div className="wa-bar"><span style={{ width: `${item.percent}%` }} /></div>
                      <span>{`${item.percent}%`}</span>
                    </div>
                ))}
              </div>
            </section>

            <section className="wa-info-card">
              <h3>BOM List</h3>
              <p>{bomLoading ? "正在加载 BOM 数据..." : `共 ${bomInfo.totalRecords} 个组件，点击可同步选择。`}</p>
              <div className="wa-bom-list">
                {(orderedBomComponents.length > 0 ? orderedBomComponents : []).map(component => (
                  <button
                    type="button"
                    className={`wa-bom-row${component.componentId === selectedBomId ? " selected" : ""}`}
                    key={component.componentId}
                    onClick={() => {
                      setSelectedBomId(component.componentId)
                      setActivePanel("bom")
                    }}
                  >
                    <span className="wa-bom-row-top">
                      <span className="wa-bom-id">{component.componentId}</span>
                      <strong>{component.nameCn || component.name || component.model}</strong>
                      <small>x{component.quantity}</small>
                    </span>
                  </button>
                ))}
                {bomInfo.components.length === 0 && (
                  <div className="wa-file">
                    <span>暂无 BOM 数据</span>
                    <small>-</small>
                  </div>
                )}
              </div>
            </section>

          </div>
        </aside>
      </main>
    </div>
  )
}

export default function WorkspaceSessionPage({ homePath = WORKSPACE_HOME_PATH }: WorkspaceSessionPageProps) {
  const state = useWorkspaceAppState({ homePath })
  return <WorkspaceAppleContent state={state} />
}
