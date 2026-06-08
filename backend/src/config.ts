import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface AppConfig {
  auth: {
    cookieName: string
    devUserId: string
    enabled: boolean
    headerName: string
    usersDir: string
  }
  cosyvoice: {
    apiUrl: string | null
    promptText: string | null
    promptWav: string | null
    root: string | null
    streamCacheMaxItems: number
    streamCacheTtlMs: number
    ttsMaxTextLength: number
  }
  openai: {
    apiKey: string
    baseUrl: string
    model: string | null
    modelProvider: string | null
    modelProviderName: string | null
    wireApi: string | null
    supportsWebsockets: boolean | null
  }
  codex: {
    modelReasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh"
    approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted"
    sandboxMode: "read-only" | "workspace-write" | "danger-full-access"
    sandboxWorkspaceWriteNetworkAccess: boolean
    workingDirectory: string
    skipGitRepoCheck: boolean
  }
  server: {
    port: number
    host: string
    corsOrigin: string | string[]
  }
  frontend: {
    host: string
    port: number
    httpsPort: number
    publicHost: string | null
    strictPort: boolean
  }
  tools: {
    remoteDesktopLauncher: string
    cad: {
      bin: string | null
      displayNum: string
      launcher: string
      noVncPort: number
      vncPort: number
    }
    paraview: {
      displayNum: string
      launcher: string
      noVncPort: number
      vncPort: number
    }
    comsol: {
      displayNum: string
      launcher: string
      noVncPort: number
      sudo: string
      vncPort: number
    }
    gnc: {
      url: string | null
    }
  }
  workspace: {
    filesystemGroup: string
    filePreviewMaxBytes: number
    templateDir: string | null
    textChunkBytes: number
    textChunkMaxBytes: number
    textFileMaxBytes: number
    usersRoot: string | null
    workspaceDir: string | null
    rpcHost: string
    rpcPort: number
  }
  whisper: {
    bin: string | null
    cudaVisibleDevices: string | null
    defaultLanguage: string | null
    ffmpegBin: string | null
    modelPath: string | null
  }
  logging: {
    level: LogLevel
    file: string
    alsoStdout: boolean
  }
}

const BACKEND_SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_ROOT = path.basename(BACKEND_SRC_DIR) === "src" || path.basename(BACKEND_SRC_DIR) === "dist"
  ? path.resolve(BACKEND_SRC_DIR, "..")
  : path.resolve(process.cwd())
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, "..")
const PROJECT_CONFIG_FILE = path.join(PROJECT_ROOT, "config.json")
const LOCAL_CONFIG_FILE = path.resolve(process.cwd(), "config.json")
const CONFIG_FILE = fs.existsSync(PROJECT_CONFIG_FILE) ? PROJECT_CONFIG_FILE : LOCAL_CONFIG_FILE

type RawOpenAiConfig = Partial<AppConfig["openai"]> & {
  base_url?: unknown
  model_provider?: unknown
  model_provider_name?: unknown
  wire_api?: unknown
  supports_websockets?: unknown
}

type RawConfig = Partial<AppConfig> & {
  openai?: RawOpenAiConfig
  [key: string]: unknown
}

const LEGACY_CAD_CONFIG_KEY = ["free", "cad"].join("")

function die(msg: string): never {
  process.stderr.write(`\n[config] ${msg}\n\n`)
  process.exit(1)
}

function buildDefaultCorsOrigins(frontend: AppConfig["frontend"]): string[] {
  const hosts = new Set(["localhost", "127.0.0.1"])
  const publicHost = frontend.publicHost?.trim()
  if (publicHost && publicHost !== "0.0.0.0") hosts.add(publicHost)
  if (frontend.host && frontend.host !== "0.0.0.0") hosts.add(frontend.host)
  return [...hosts].flatMap(host => [
    `http://${host}:${frontend.port}`,
    `https://${host}:${frontend.httpsPort}`,
  ])
}

function normalizeCorsOrigin(
  value: Partial<AppConfig["server"]>["corsOrigin"],
  fallback: string[],
): string | string[] {
  if (value == null) return fallback

  if (typeof value === "string") {
    const origin = value.trim()
    if (!origin) die("server.corsOrigin 不能为空字符串。")
    return origin
  }

  if (Array.isArray(value)) {
    const origins = value
      .map((origin) => (typeof origin === "string" ? origin.trim() : ""))
      .filter((origin) => origin.length > 0)

    if (origins.length === 0) {
      die("server.corsOrigin 数组不能为空。")
    }

    return origins
  }

  die("server.corsOrigin 必须是字符串或字符串数组。")
}

function optionalString(value: unknown, field: string): string | null {
  if (value == null) return null
  if (typeof value !== "string") die(`${field} 必须是字符串。`)
  const trimmed = value.trim()
  return trimmed || null
}

function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value == null) return null
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (normalized === "true") return true
    if (normalized === "false") return false
  }
  die(`${field} 必须是布尔值 true/false。`)
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value == null) return null
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) die(`${field} 必须是数字。`)
  return numeric
}

function positiveInteger(value: unknown, field: string, fallback: number): number {
  const numeric = optionalNumber(value, field)
  if (numeric == null) return fallback
  const integer = Math.trunc(numeric)
  if (integer <= 0) die(`${field} 必须是正整数。`)
  return integer
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const numeric = optionalNumber(value, field)
  if (numeric == null) die(`${field} 未设置。`)
  const integer = Math.trunc(numeric)
  if (integer <= 0) die(`${field} 必须是正整数。`)
  return integer
}

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    die(
      `配置文件不存在: ${CONFIG_FILE}\n` +
      `请在 open_codex_web/config.json 中配置 openai、server、frontend、workspace 等参数后再启动。`
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"))
  } catch (err) {
    die(`config.json 不是合法 JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const cfg = raw as RawConfig

  // env 覆盖（方便 CI / 临时切换）
  const envKey = process.env.OPENAI_API_KEY
  const envBase = process.env.OPENAI_BASE_URL

  const openai: RawOpenAiConfig = cfg.openai ?? {}
  const apiKey = (envKey ?? openai.apiKey ?? "").trim()
  const baseUrl = (envBase ?? openai.baseUrl ?? optionalString(openai.base_url, "openai.base_url") ?? "").trim()
  const model = optionalString(openai.model, "openai.model")
  const modelProvider = optionalString(openai.modelProvider ?? openai.model_provider, "openai.modelProvider")
  const modelProviderName = optionalString(openai.modelProviderName ?? openai.model_provider_name, "openai.modelProviderName")
  const wireApi = optionalString(openai.wireApi ?? openai.wire_api, "openai.wireApi")
  const supportsWebsockets = optionalBoolean(
    openai.supportsWebsockets ?? openai.supports_websockets,
    "openai.supportsWebsockets",
  )

  if (!apiKey) die("openai.apiKey 未设置（或为空）。")
  if (apiKey === "sk-REPLACE-ME") die("openai.apiKey 仍是占位符，请填真实 key。")
  if (!baseUrl) die("openai.baseUrl 未设置（或为空）。")
  try { new URL(baseUrl) } catch { die(`openai.baseUrl 不是合法 URL: ${baseUrl}`) }

  const codex = cfg.codex ?? {} as Partial<AppConfig["codex"]>
  const auth = cfg.auth ?? {} as Partial<AppConfig["auth"]>
  const server = cfg.server ?? {} as Partial<AppConfig["server"]>
  const frontend = cfg.frontend ?? {} as Partial<AppConfig["frontend"]>
  const tools = cfg.tools ?? {} as Partial<AppConfig["tools"]>
  const cadTool = tools.cad ?? {} as Partial<AppConfig["tools"]["cad"]>
  const paraviewTool = tools.paraview ?? {} as Partial<AppConfig["tools"]["paraview"]>
  const comsolTool = tools.comsol ?? {} as Partial<AppConfig["tools"]["comsol"]>
  const gncTool = tools.gnc ?? {} as Partial<AppConfig["tools"]["gnc"]>
  const workspace = (
    cfg.workspace ??
    (typeof cfg[LEGACY_CAD_CONFIG_KEY] === "object" && cfg[LEGACY_CAD_CONFIG_KEY] !== null
      ? cfg[LEGACY_CAD_CONFIG_KEY]
      : {})
  ) as Partial<AppConfig["workspace"]>
  const logging = cfg.logging ?? {} as Partial<AppConfig["logging"]>
  const whisper = cfg.whisper ?? {} as Partial<AppConfig["whisper"]>
  const cosyvoice = cfg.cosyvoice ?? {} as Partial<AppConfig["cosyvoice"]>
  const envServerPort = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : null

  if (envServerPort !== null && (!Number.isInteger(envServerPort) || envServerPort <= 0)) {
    die(`BACKEND_PORT 必须是正整数: ${process.env.BACKEND_PORT}`)
  }

  const frontendConfig = {
    host: optionalString(frontend.host, "frontend.host") ?? "0.0.0.0",
    port: requiredPositiveInteger(frontend.port, "frontend.port"),
    httpsPort: requiredPositiveInteger(frontend.httpsPort, "frontend.httpsPort"),
    publicHost: optionalString(frontend.publicHost, "frontend.publicHost"),
    strictPort: optionalBoolean(frontend.strictPort, "frontend.strictPort") ?? true,
  }

  return {
    auth: {
      cookieName: optionalString(process.env.CODEX_AUTH_COOKIE_NAME ?? auth.cookieName, "auth.cookieName") ?? "codex_user_id",
      devUserId: optionalString(process.env.CODEX_DEV_USER_ID ?? auth.devUserId, "auth.devUserId") ?? "default",
      enabled: optionalBoolean(process.env.CODEX_AUTH_ENABLED ?? auth.enabled, "auth.enabled") ?? false,
      headerName: optionalString(process.env.CODEX_AUTH_HEADER_NAME ?? auth.headerName, "auth.headerName") ?? "x-codex-user-id",
      usersDir: optionalString(process.env.CODEX_USERS_DIR ?? auth.usersDir, "auth.usersDir") ?? "users",
    },
    openai: {
      apiKey,
      baseUrl,
      model,
      modelProvider,
      modelProviderName,
      wireApi,
      supportsWebsockets,
    },
    codex: {
      modelReasoningEffort: codex.modelReasoningEffort ?? "medium",
      approvalPolicy: codex.approvalPolicy ?? "never",
      sandboxMode: codex.sandboxMode ?? "danger-full-access",
      sandboxWorkspaceWriteNetworkAccess: optionalBoolean(
        codex.sandboxWorkspaceWriteNetworkAccess,
        "codex.sandboxWorkspaceWriteNetworkAccess",
      ) ?? false,
      workingDirectory: codex.workingDirectory || os.homedir(),
      skipGitRepoCheck: codex.skipGitRepoCheck ?? true,
    },
    server: {
      port: envServerPort ?? requiredPositiveInteger(server.port, "server.port"),
      host: server.host ?? "0.0.0.0",
      corsOrigin: normalizeCorsOrigin(server.corsOrigin, buildDefaultCorsOrigins(frontendConfig)),
    },
    frontend: {
      ...frontendConfig,
    },
    tools: {
      remoteDesktopLauncher: optionalString(tools.remoteDesktopLauncher, "tools.remoteDesktopLauncher")
        ?? die("tools.remoteDesktopLauncher 未设置。"),
      cad: {
        bin: optionalString(cadTool.bin, "tools.cad.bin"),
        displayNum: optionalString(cadTool.displayNum, "tools.cad.displayNum")
          ?? die("tools.cad.displayNum 未设置。"),
        launcher: optionalString(cadTool.launcher, "tools.cad.launcher")
          ?? die("tools.cad.launcher 未设置。"),
        noVncPort: requiredPositiveInteger(cadTool.noVncPort, "tools.cad.noVncPort"),
        vncPort: requiredPositiveInteger(cadTool.vncPort, "tools.cad.vncPort"),
      },
      paraview: {
        displayNum: optionalString(paraviewTool.displayNum, "tools.paraview.displayNum")
          ?? die("tools.paraview.displayNum 未设置。"),
        launcher: optionalString(paraviewTool.launcher, "tools.paraview.launcher")
          ?? die("tools.paraview.launcher 未设置。"),
        noVncPort: requiredPositiveInteger(paraviewTool.noVncPort, "tools.paraview.noVncPort"),
        vncPort: requiredPositiveInteger(paraviewTool.vncPort, "tools.paraview.vncPort"),
      },
      comsol: {
        displayNum: optionalString(comsolTool.displayNum, "tools.comsol.displayNum")
          ?? die("tools.comsol.displayNum 未设置。"),
        launcher: optionalString(comsolTool.launcher, "tools.comsol.launcher")
          ?? die("tools.comsol.launcher 未设置。"),
        noVncPort: requiredPositiveInteger(comsolTool.noVncPort, "tools.comsol.noVncPort"),
        sudo: optionalString(comsolTool.sudo, "tools.comsol.sudo") ?? "sudo",
        vncPort: requiredPositiveInteger(comsolTool.vncPort, "tools.comsol.vncPort"),
      },
      gnc: {
        url: optionalString(gncTool.url, "tools.gnc.url"),
      },
    },
    workspace: {
      filesystemGroup: optionalString(process.env.WORKSPACE_FILESYSTEM_GROUP ?? workspace.filesystemGroup, "workspace.filesystemGroup") ?? "xieteam",
      filePreviewMaxBytes: positiveInteger(
        process.env.WORKSPACE_FILE_PREVIEW_MAX_BYTES ?? workspace.filePreviewMaxBytes,
        "workspace.filePreviewMaxBytes",
        1024 * 1024,
      ),
      textChunkBytes: positiveInteger(
        process.env.WORKSPACE_TEXT_CHUNK_BYTES ?? workspace.textChunkBytes,
        "workspace.textChunkBytes",
        512 * 1024,
      ),
      textChunkMaxBytes: positiveInteger(
        process.env.WORKSPACE_TEXT_CHUNK_MAX_BYTES ?? workspace.textChunkMaxBytes,
        "workspace.textChunkMaxBytes",
        1024 * 1024,
      ),
      textFileMaxBytes: positiveInteger(
        process.env.WORKSPACE_TEXT_FILE_MAX_BYTES ?? workspace.textFileMaxBytes,
        "workspace.textFileMaxBytes",
        8 * 1024 * 1024,
      ),
      templateDir: optionalString(workspace.templateDir ?? workspace.workspaceDir, "workspace.templateDir"),
      usersRoot: optionalString(workspace.usersRoot, "workspace.usersRoot"),
      workspaceDir: optionalString(workspace.templateDir ?? workspace.workspaceDir, "workspace.workspaceDir"),
      rpcHost: optionalString(workspace.rpcHost, "workspace.rpcHost")
        ?? die("workspace.rpcHost 未设置。"),
      rpcPort: requiredPositiveInteger(workspace.rpcPort, "workspace.rpcPort"),
    },
    whisper: {
      bin: optionalString(process.env.WHISPER_CPP_BIN ?? whisper.bin, "whisper.bin"),
      cudaVisibleDevices: optionalString(process.env.WHISPER_CUDA_VISIBLE_DEVICES ?? whisper.cudaVisibleDevices, "whisper.cudaVisibleDevices"),
      defaultLanguage: optionalString(process.env.WHISPER_LANGUAGE ?? whisper.defaultLanguage, "whisper.defaultLanguage"),
      ffmpegBin: optionalString(process.env.WHISPER_FFMPEG_BIN ?? whisper.ffmpegBin, "whisper.ffmpegBin"),
      modelPath: optionalString(process.env.WHISPER_MODEL_PATH ?? whisper.modelPath, "whisper.modelPath"),
    },
    cosyvoice: {
      apiUrl: optionalString(process.env.COSYVOICE_API_URL ?? cosyvoice.apiUrl, "cosyvoice.apiUrl"),
      promptText: optionalString(process.env.COSYVOICE_PROMPT_TEXT ?? cosyvoice.promptText, "cosyvoice.promptText"),
      promptWav: optionalString(process.env.COSYVOICE_PROMPT_WAV ?? cosyvoice.promptWav, "cosyvoice.promptWav"),
      root: optionalString(process.env.COSYVOICE_ROOT ?? cosyvoice.root, "cosyvoice.root"),
      streamCacheMaxItems: positiveInteger(
        process.env.COSYVOICE_TTS_CACHE_MAX_ITEMS ?? cosyvoice.streamCacheMaxItems,
        "cosyvoice.streamCacheMaxItems",
        64,
      ),
      streamCacheTtlMs: positiveInteger(
        process.env.COSYVOICE_TTS_CACHE_TTL_MS ?? cosyvoice.streamCacheTtlMs,
        "cosyvoice.streamCacheTtlMs",
        1000 * 60 * 10,
      ),
      ttsMaxTextLength: positiveInteger(
        process.env.COSYVOICE_TTS_MAX_TEXT_LENGTH ?? cosyvoice.ttsMaxTextLength,
        "cosyvoice.ttsMaxTextLength",
        5000,
      ),
    },
    logging: {
      level: logging.level ?? "info",
      file: logging.file ?? "logs/app.log",
      alsoStdout: logging.alsoStdout ?? true,
    },
  }
}
