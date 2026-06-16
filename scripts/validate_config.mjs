#!/usr/bin/env node
import fs from "node:fs"
import net from "node:net"
import path from "node:path"

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const DEFAULT_CONFIG = path.join(PROJECT_ROOT, "config.json")
const DEFAULT_TIMEOUT_MS = 5000

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG,
    json: false,
    skipServices: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--config") {
      args.config = path.resolve(argv[++index] ?? "")
    } else if (arg === "--json") {
      args.json = true
    } else if (arg === "--skip-services") {
      args.skipServices = true
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++index])
      if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
        throw new Error("--timeout-ms must be a positive number")
      }
    } else if (arg === "-h" || arg === "--help") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/validate_config.mjs [options]

Options:
  --config <path>       Config file to validate. Defaults to ./config.json.
  --skip-services       Only validate local config shape and local files.
  --timeout-ms <ms>     Timeout for each network check. Defaults to 5000.
  --json                Print machine-readable JSON.
  -h, --help            Show this help.`)
}

function add(list, severity, field, message, detail) {
  list.push({ severity, field, message, ...(detail ? { detail } : {}) })
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function get(config, field) {
  return field.split(".").reduce((current, part) => current?.[part], config)
}

function isPlaceholder(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "xxx"
}

function walkPlaceholders(value, prefix, issues) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkPlaceholders(item, `${prefix}[${index}]`, issues))
    return
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith("_")) continue
      walkPlaceholders(item, prefix ? `${prefix}.${key}` : key, issues)
    }
    return
  }
  if (isPlaceholder(value)) {
    add(issues, "error", prefix, "仍是占位值 xxx，请按本机环境填写")
  }
}

function optionalString(config, field, issues) {
  const value = get(config, field)
  if (value == null || value === "") return null
  if (typeof value !== "string") {
    add(issues, "error", field, "必须是字符串")
    return null
  }
  return value.trim() || null
}

function requiredString(config, field, issues) {
  const value = optionalString(config, field, issues)
  if (!value) add(issues, "error", field, "未设置或为空")
  return value
}

function optionalBoolean(config, field, issues) {
  const value = get(config, field)
  if (value == null) return null
  if (typeof value === "boolean") return value
  if (typeof value === "string" && ["true", "false"].includes(value.trim().toLowerCase())) {
    return value.trim().toLowerCase() === "true"
  }
  add(issues, "error", field, "必须是布尔值 true/false")
  return null
}

function requiredPositiveInteger(config, field, issues) {
  const value = get(config, field)
  if (value == null || value === "") {
    add(issues, "error", field, "未设置")
    return null
  }
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    add(issues, "error", field, "必须是正整数")
    return null
  }
  return numeric
}

function optionalPositiveInteger(config, field, issues) {
  const value = get(config, field)
  if (value == null || value === "") return null
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    add(issues, "error", field, "必须是正整数")
    return null
  }
  return numeric
}

function optionalUrl(config, field, issues) {
  const value = optionalString(config, field, issues)
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    add(issues, "error", field, "不是合法 URL", value)
    return null
  }
}

function optionalEnum(config, field, allowed, issues) {
  const value = optionalString(config, field, issues)
  if (!value) return null
  if (!allowed.includes(value)) {
    add(issues, "error", field, `必须是以下值之一: ${allowed.join(", ")}`)
    return null
  }
  return value
}

function checkExecutable(config, field, issues) {
  const value = requiredString(config, field, issues)
  if (!value || isPlaceholder(value)) return
  try {
    fs.accessSync(value, fs.constants.X_OK)
  } catch {
    add(issues, "error", field, "文件不存在或不可执行", value)
  }
}

function checkOptionalExecutable(config, field, issues) {
  const value = optionalString(config, field, issues)
  if (!value || isPlaceholder(value)) return
  try {
    fs.accessSync(value, fs.constants.X_OK)
  } catch {
    add(issues, "warning", field, "文件不存在或不可执行", value)
  }
}

function checkDirectory(config, field, issues, { required = true } = {}) {
  const value = required ? requiredString(config, field, issues) : optionalString(config, field, issues)
  if (!value || isPlaceholder(value)) return
  try {
    if (!fs.statSync(value).isDirectory()) add(issues, "error", field, "不是目录", value)
  } catch {
    add(issues, "error", field, "目录不存在", value)
  }
}

function validateShape(config, issues) {
  if (!isObject(config)) {
    add(issues, "error", "config", "顶层配置必须是 JSON object")
    return
  }

  walkPlaceholders(config, "", issues)

  requiredString(config, "openai.apiKey", issues)
  optionalUrl(config, "openai.baseUrl", issues)
  optionalString(config, "openai.model", issues)

  requiredString(config, "chatModel.apiKey", issues)
  optionalUrl(config, "chatModel.baseUrl", issues)
  requiredString(config, "chatModel.model", issues)
  optionalBoolean(config, "chatModel.responsesCompat", issues)

  optionalString(config, "codex.modelProvider", issues)
  optionalString(config, "codex.modelProviderName", issues)
  optionalString(config, "codex.wireApi", issues)
  optionalBoolean(config, "codex.supportsWebsockets", issues)
  optionalEnum(config, "codex.modelReasoningEffort", ["minimal", "low", "medium", "high", "xhigh"], issues)
  optionalEnum(config, "codex.approvalPolicy", ["never", "on-request", "on-failure", "untrusted"], issues)
  optionalEnum(config, "codex.sandboxMode", ["read-only", "workspace-write", "danger-full-access"], issues)
  optionalBoolean(config, "codex.sandboxWorkspaceWriteNetworkAccess", issues)
  optionalBoolean(config, "codex.skipGitRepoCheck", issues)

  requiredPositiveInteger(config, "server.port", issues)
  optionalString(config, "server.host", issues)
  optionalString(config, "frontend.host", issues)
  optionalString(config, "frontend.publicHost", issues)
  requiredPositiveInteger(config, "frontend.port", issues)
  requiredPositiveInteger(config, "frontend.httpsPort", issues)
  optionalBoolean(config, "frontend.strictPort", issues)

  optionalString(config, "tmux.backendSession", issues)
  optionalString(config, "tmux.frontendSession", issues)

  checkDirectory(config, "workspace.templateDir", issues)
  checkDirectory(config, "workspace.usersRoot", issues, { required: false })
  optionalString(config, "workspace.filesystemGroup", issues)
  requiredString(config, "workspace.rpcHost", issues)
  requiredPositiveInteger(config, "workspace.rpcPort", issues)
  optionalPositiveInteger(config, "workspace.filePreviewMaxBytes", issues)
  optionalPositiveInteger(config, "workspace.textFileMaxBytes", issues)
  optionalPositiveInteger(config, "workspace.textChunkBytes", issues)
  optionalPositiveInteger(config, "workspace.textChunkMaxBytes", issues)

  checkExecutable(config, "tools.remoteDesktopLauncher", issues)
  for (const tool of ["cad", "paraview", "comsol"]) {
    requiredString(config, `tools.${tool}.displayNum`, issues)
    checkExecutable(config, `tools.${tool}.launcher`, issues)
    requiredPositiveInteger(config, `tools.${tool}.vncPort`, issues)
    requiredPositiveInteger(config, `tools.${tool}.noVncPort`, issues)
  }
  checkOptionalExecutable(config, "tools.cad.bin", issues)
  optionalString(config, "tools.comsol.sudo", issues)
  optionalUrl(config, "tools.gnc.url", issues)

  optionalUrl(config, "funasr.apiUrl", issues)
  optionalUrl(config, "cosyvoice.apiUrl", issues)
  optionalString(config, "cosyvoice.promptText", issues)
  optionalString(config, "cosyvoice.promptWav", issues)
  optionalString(config, "cosyvoice.root", issues)
  optionalPositiveInteger(config, "cosyvoice.streamCacheTtlMs", issues)
  optionalPositiveInteger(config, "cosyvoice.streamCacheMaxItems", issues)
  optionalPositiveInteger(config, "cosyvoice.ttsMaxTextLength", issues)

  optionalString(config, "compliance.database.host", issues)
  requiredPositiveInteger(config, "compliance.database.port", issues)
  optionalString(config, "compliance.database.user", issues)
  optionalString(config, "compliance.database.password", issues)
  optionalString(config, "compliance.database.catalog.db", issues)
  optionalString(config, "compliance.database.reliability.db", issues)

  optionalEnum(config, "logging.level", ["debug", "info", "warn", "error"], issues)
  optionalString(config, "logging.file", issues)
  optionalBoolean(config, "logging.alsoStdout", issues)
}

function tcpCheck({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let done = false
    const finish = (error) => {
      if (done) return
      done = true
      socket.removeAllListeners()
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => finish())
    socket.once("timeout", () => finish(new Error("连接超时")))
    socket.once("error", (error) => finish(error))
  })
}

async function httpCheck({ url, timeoutMs, headers }) {
  const response = await fetch(url, {
    headers,
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.status >= 500) throw new Error(`HTTP ${response.status}`)
}

function portFromUrl(url) {
  return Number(url.port || (url.protocol === "https:" ? 443 : 80))
}

async function checkTcpService(issues, field, url, timeoutMs) {
  try {
    await tcpCheck({ host: url.hostname, port: portFromUrl(url), timeoutMs })
  } catch (error) {
    add(issues, "error", field, "服务 TCP 连接失败", `${url.hostname}:${portFromUrl(url)} ${error.message}`)
  }
}

async function checkHttpService(issues, field, url, timeoutMs, headers) {
  try {
    await httpCheck({ url: String(url), timeoutMs, headers })
  } catch (error) {
    add(issues, "error", field, "HTTP 服务访问失败", `${url} ${error.message}`)
  }
}

async function validateServices(config, issues, timeoutMs) {
  const chatBase = optionalUrl(config, "chatModel.baseUrl", [])
  if (chatBase && !isPlaceholder(get(config, "chatModel.apiKey"))) {
    const modelsUrl = new URL("models", chatBase.href.endsWith("/") ? chatBase : `${chatBase.href.replace(/\/+$/u, "")}/`)
    await checkHttpService(issues, "chatModel.baseUrl", modelsUrl, timeoutMs, {
      Authorization: `Bearer ${get(config, "chatModel.apiKey")}`,
    })
  }

  const openaiBase = optionalUrl(config, "openai.baseUrl", [])
  if (openaiBase && !isPlaceholder(get(config, "openai.apiKey"))) {
    const modelsUrl = new URL("models", openaiBase.href.endsWith("/") ? openaiBase : `${openaiBase.href.replace(/\/+$/u, "")}/`)
    await checkHttpService(issues, "openai.baseUrl", modelsUrl, timeoutMs, {
      Authorization: `Bearer ${get(config, "openai.apiKey")}`,
    })
  }

  const funasrUrl = optionalUrl(config, "funasr.apiUrl", [])
  if (funasrUrl) await checkTcpService(issues, "funasr.apiUrl", funasrUrl, timeoutMs)

  const cosyvoiceUrl = optionalUrl(config, "cosyvoice.apiUrl", [])
  if (cosyvoiceUrl) await checkTcpService(issues, "cosyvoice.apiUrl", cosyvoiceUrl, timeoutMs)

  const gncUrl = optionalUrl(config, "tools.gnc.url", [])
  if (gncUrl) await checkHttpService(issues, "tools.gnc.url", gncUrl, timeoutMs)

  const dbHost = optionalString(config, "compliance.database.host", [])
  const dbPort = requiredPositiveInteger(config, "compliance.database.port", [])
  if (dbHost && dbPort) {
    try {
      await tcpCheck({ host: dbHost, port: dbPort, timeoutMs })
    } catch (error) {
      add(issues, "error", "compliance.database", "数据库 TCP 连接失败", `${dbHost}:${dbPort} ${error.message}`)
    }
  }
}

function printResults({ configPath, issues, skippedServices }) {
  const errors = issues.filter((issue) => issue.severity === "error")
  const warnings = issues.filter((issue) => issue.severity === "warning")
  console.log(`Config: ${configPath}`)
  console.log(`Result: ${errors.length === 0 ? "OK" : "FAILED"} (${errors.length} errors, ${warnings.length} warnings${skippedServices ? ", service checks skipped" : ""})`)
  if (issues.length === 0) {
    console.log("No config problems found.")
    return
  }
  console.log("")
  for (const issue of issues) {
    const label = issue.severity === "error" ? "ERROR" : "WARN "
    console.log(`${label} ${issue.field}: ${issue.message}`)
    if (issue.detail) console.log(`      ${issue.detail}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const issues = []
  let config

  if (!fs.existsSync(args.config)) {
    add(issues, "error", "config", "配置文件不存在", args.config)
  } else {
    try {
      config = JSON.parse(fs.readFileSync(args.config, "utf8"))
    } catch (error) {
      add(issues, "error", "config", "不是合法 JSON", error.message)
    }
  }

  if (config) {
    validateShape(config, issues)
    if (!args.skipServices && issues.every((issue) => issue.severity !== "error")) {
      await validateServices(config, issues, args.timeoutMs)
    }
  }

  if (args.json) {
    console.log(JSON.stringify({
      config: args.config,
      ok: issues.every((issue) => issue.severity !== "error"),
      issues,
      skippedServices: args.skipServices,
    }, null, 2))
  } else {
    printResults({ configPath: args.config, issues, skippedServices: args.skipServices })
  }

  process.exit(issues.some((issue) => issue.severity === "error") ? 1 : 0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(2)
})
