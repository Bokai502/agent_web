#!/usr/bin/env node
import fs from "node:fs/promises"
import fsSync from "node:fs"
import net from "node:net"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const DEFAULT_TIMEOUT_MS = 5000
const HEAVY_TIMEOUT_MS = 300000

function parseArgs(argv) {
  const args = {
    config: path.join(PROJECT_ROOT, "config.json"),
    includeWeb: false,
    json: false,
    localDeps: false,
    quick: false,
    requireComsolRuntime: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--config") {
      args.config = path.resolve(argv[++index] ?? "")
    } else if (arg === "--include-web") {
      args.includeWeb = true
    } else if (arg === "--json") {
      args.json = true
    } else if (arg === "--local-deps") {
      args.localDeps = true
    } else if (arg === "--quick") {
      args.quick = true
    } else if (arg === "--require-comsol-runtime") {
      args.requireComsolRuntime = true
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
  node scripts/check_function_interfaces.mjs [options]

Options:
  --config <path>              Config file to read. Defaults to ./config.json.
  --quick                      Skip real generation calls such as /responses and CosyVoice TTS.
  --include-web                Also test this app's web backend API and frontend port.
  --local-deps                 Also test local helper binaries such as ffmpeg.
  --require-comsol-runtime     Fail if no active COMSOL mphserver is detected.
  --timeout-ms <ms>            Default timeout for lightweight checks. Defaults to 5000.
  --json                       Print machine-readable JSON.
  -h, --help                   Show this help.

The default scope focuses on functional tool/model interfaces and excludes the
web frontend/backend ports unless --include-web is passed.`)
}

function maskUrl(value) {
  if (!value) return ""
  try {
    const url = new URL(value)
    url.username = url.username ? "***" : ""
    url.password = url.password ? "***" : ""
    return url.toString()
  } catch {
    return String(value).replace(/([?&](?:api[_-]?key|key|token)=)[^&]+/giu, "$1***")
  }
}

function trimBody(value, max = 300) {
  if (!value) return ""
  const text = String(value).replace(/\s+/gu, " ").trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function resolveUrl(baseUrl, suffix = "") {
  const cleanBase = String(baseUrl ?? "").replace(/\/+$/u, "")
  const cleanSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`
  return `${cleanBase}${cleanSuffix}`
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"))
}

function defaultCosyVoiceRoot() {
  return path.join(PROJECT_ROOT, "backend", "cosyvoice3", "CosyVoice")
}

function defaultCosyPromptWav(root) {
  return path.join(root, "asset", "zero_shot_prompt.wav")
}

function executableExists(file) {
  if (!file) return false
  try {
    fsSync.accessSync(file, fsSync.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function fileExists(file) {
  if (!file) return false
  try {
    return fsSync.statSync(file).isFile()
  } catch {
    return false
  }
}

async function runCheck(check) {
  const startedAt = process.hrtime.bigint()
  try {
    if (check.skip) {
      return {
        ...check,
        ok: true,
        skipped: true,
        durationMs: 0,
        message: check.skip,
      }
    }
    const details = await check.run()
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    return {
      ...check,
      ok: true,
      skipped: false,
      durationMs: Math.round(durationMs),
      ...details,
    }
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    return {
      ...check,
      ok: false,
      skipped: false,
      durationMs: Math.round(durationMs),
      error: error instanceof Error ? error.message : String(error),
    }
  }
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
      else resolve({ message: "tcp connected" })
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => finish())
    socket.once("timeout", () => finish(new Error("tcp timeout")))
    socket.once("error", (error) => finish(error))
  })
}

function vncRfbCheck({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let buffer = Buffer.alloc(0)
    let done = false
    const finish = (error, details) => {
      if (done) return
      done = true
      socket.removeAllListeners()
      socket.destroy()
      if (error) reject(error)
      else resolve(details)
    }
    socket.setTimeout(timeoutMs)
    socket.once("timeout", () => finish(new Error("vnc rfb handshake timeout")))
    socket.once("error", (error) => finish(error))
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length >= 4) {
        const banner = buffer.toString("ascii", 0, Math.min(buffer.length, 12))
        if (!banner.startsWith("RFB ")) {
          finish(new Error(`unexpected VNC banner: ${JSON.stringify(banner)}`))
          return
        }
        finish(null, { message: `RFB handshake ${banner.trim()}` })
      }
    })
  })
}

async function httpCheck({ url, timeoutMs, method = "GET", headers, body, okStatus = (status) => status >= 200 && status < 500 }) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text().catch(() => "")
  if (!okStatus(response.status)) {
    throw new Error(`HTTP ${response.status}${text ? ` ${trimBody(text)}` : ""}`)
  }
  return {
    message: `HTTP ${response.status}`,
    status: response.status,
    bytes: Buffer.byteLength(text),
  }
}

async function openAiModelsCheck({ baseUrl, apiKey, timeoutMs }) {
  const url = resolveUrl(baseUrl, "/models")
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${trimBody(text)}`)
  }
  let modelCount = null
  try {
    const payload = JSON.parse(text)
    modelCount = Array.isArray(payload.data) ? payload.data.length : null
  } catch {
    modelCount = null
  }
  return {
    message: modelCount == null ? `HTTP ${response.status}` : `HTTP ${response.status}, models=${modelCount}`,
    status: response.status,
  }
}

async function responsesCheck({ baseUrl, apiKey, model, timeoutMs }) {
  const url = resolveUrl(baseUrl, "/responses")
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: "Reply with OK.",
      max_output_tokens: 16,
      model,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${trimBody(text)}`)
  }
  let outputChars = null
  try {
    const payload = JSON.parse(text)
    outputChars = JSON.stringify(payload.output ?? payload).length
  } catch {
    outputChars = text.length
  }
  return {
    message: `HTTP ${response.status}, response_bytes=${outputChars}`,
    status: response.status,
  }
}

async function xmlRpcExecuteCodeCheck({ host, port, timeoutMs }) {
  const url = `http://${host}:${port}/`
  const body = `<?xml version="1.0"?>
<methodCall>
  <methodName>execute_code</methodName>
  <params>
    <param>
      <value><string>result = "interface-check-ok"</string></value>
    </param>
  </params>
</methodCall>`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${trimBody(text)}`)
  }
  if (!/<name>\s*success\s*<\/name>\s*<value>\s*<boolean>\s*1\s*<\/boolean>/iu.test(text)) {
    throw new Error(`RPC execute_code returned unexpected body: ${trimBody(text)}`)
  }
  return { message: `XML-RPC execute_code ok, HTTP ${response.status}`, status: response.status }
}

async function cosyVoiceTtsCheck({ endpoint, promptText, promptWav, timeoutMs }) {
  const promptBytes = await fs.readFile(promptWav)
  const form = new FormData()
  form.set("tts_text", "interface test")
  form.set("prompt_text", promptText)
  form.set("prompt_wav", new Blob([promptBytes], { type: "audio/wav" }), "prompt.wav")
  const response = await fetch(endpoint, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${trimBody(bytes.toString("utf8"))}`)
  }
  if (bytes.length < 44) {
    throw new Error(`audio payload too small: ${bytes.length} bytes`)
  }
  return {
    message: `HTTP ${response.status}, audio_bytes=${bytes.length}`,
    status: response.status,
    bytes: bytes.length,
  }
}

function makeSilentWavBuffer() {
  const dataBytes = 3200
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write("RIFF", 0, "ascii")
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write("WAVE", 8, "ascii")
  buffer.write("fmt ", 12, "ascii")
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24)
  buffer.writeUInt32LE(16000 * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36, "ascii")
  buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}

async function funAsrTranscriptionCheck({ endpoint, timeoutMs }) {
  const wav = makeSilentWavBuffer()
  const audioBytes = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)
  const form = new FormData()
  form.set("file", new Blob([audioBytes], { type: "audio/wav" }), "interface-check.wav")
  form.set("language", "auto")
  form.set("response_format", "json")

  const response = await fetch(endpoint, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${trimBody(text)}`)
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`invalid JSON response: ${trimBody(text)}`)
  }
  if (typeof payload?.text !== "string") {
    throw new Error(`missing text field in response: ${trimBody(text)}`)
  }
  return {
    message: `HTTP ${response.status}, text_length=${payload.text.length}`,
    status: response.status,
  }
}

async function getListeningPorts() {
  try {
    const { stdout } = await execFileAsync("ss", ["-ltnp"], { timeout: 3000, maxBuffer: 1024 * 1024 })
    return stdout
  } catch {
    return ""
  }
}

async function discoverComsolMphPorts() {
  const ports = new Set()
  try {
    const { stdout } = await execFileAsync("pgrep", ["-af", "mphserver|comsol"], { timeout: 3000, maxBuffer: 1024 * 1024 })
    for (const line of stdout.split(/\n/u)) {
      if (!/mphserver|comsol/iu.test(line)) continue
      for (const match of line.matchAll(/(?:-port|port)\s+([0-9]{2,5})/giu)) {
        ports.add(Number(match[1]))
      }
    }
  } catch {
    // No matching process is normal when no simulation is running.
  }

  const listening = await getListeningPorts()
  for (const line of listening.split(/\n/u)) {
    if (!/mph|comsol/iu.test(line)) continue
    const match = line.match(/:([0-9]{2,5})\s+/u)
    if (match) ports.add(Number(match[1]))
  }
  return [...ports].sort((a, b) => a - b)
}

async function readComsolLocalMphPort() {
  const yamlPath = path.join(
    PROJECT_ROOT,
    "backend",
    "workflow_agents",
    "agents",
    "sim_cli_tools",
    "runtime",
    "codex_agents",
    "vendor",
    "simulation_runtime",
    "comsol_runtime",
    "configs",
    "comsol_connection_local.yaml",
  )
  try {
    const text = await fs.readFile(yamlPath, "utf8")
    const match = text.match(/^\s*local_mph_port:\s*([0-9]+)\s*$/mu)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

function makePortTarget(host, port) {
  return `${host}:${port}`
}

function pushHttpToolChecks(checks, { name, url, required, timeoutMs }) {
  checks.push({
    group: "tool-http",
    name,
    target: maskUrl(url),
    required,
    run: () => httpCheck({ url, timeoutMs }),
  })
}

async function buildChecks(config, args) {
  const checks = []
  const tools = config.tools ?? {}
  const workspace = config.workspace ?? {}

  for (const [toolName, toolConfig] of [
    ["FreeCAD", tools.cad],
    ["ParaView", tools.paraview],
    ["COMSOL", tools.comsol],
  ]) {
    if (!toolConfig) continue
    if (toolConfig.noVncPort) {
      const url = `http://127.0.0.1:${toolConfig.noVncPort}/`
      checks.push({
        group: "remote-gui",
        name: `${toolName} noVNC HTTP`,
        target: maskUrl(url),
        required: true,
        run: () => httpCheck({ url, timeoutMs: args.timeoutMs }),
      })
    }
    if (toolConfig.vncPort) {
      checks.push({
        group: "remote-gui",
        name: `${toolName} VNC RFB`,
        target: makePortTarget("127.0.0.1", toolConfig.vncPort),
        required: true,
        run: () => vncRfbCheck({ host: "127.0.0.1", port: toolConfig.vncPort, timeoutMs: args.timeoutMs }),
      })
    }
    if (toolConfig.launcher) {
      checks.push({
        group: "local-executable",
        name: `${toolName} launcher executable`,
        target: toolConfig.launcher,
        required: true,
        run: async () => {
          if (!executableExists(toolConfig.launcher)) throw new Error("missing or not executable")
          return { message: "executable exists" }
        },
      })
    }
  }

  if (workspace.rpcHost && workspace.rpcPort) {
    checks.push({
      group: "freecad-rpc",
      name: "FreeCAD XML-RPC TCP",
      target: makePortTarget(workspace.rpcHost, workspace.rpcPort),
      required: true,
      run: () => tcpCheck({ host: workspace.rpcHost, port: workspace.rpcPort, timeoutMs: args.timeoutMs }),
    })
    checks.push({
      group: "freecad-rpc",
      name: "FreeCAD XML-RPC execute_code",
      target: `http://${workspace.rpcHost}:${workspace.rpcPort}/ execute_code()`,
      required: true,
      run: () => xmlRpcExecuteCodeCheck({ host: workspace.rpcHost, port: workspace.rpcPort, timeoutMs: args.timeoutMs }),
    })
  }

  if (tools.gnc?.url) {
    pushHttpToolChecks(checks, {
      name: "GNC external tool URL",
      url: tools.gnc.url,
      required: true,
      timeoutMs: args.timeoutMs,
    })
  }

  const cosyvoice = config.cosyvoice ?? {}
  const cosyRoot = cosyvoice.root || defaultCosyVoiceRoot()
  const cosyEndpoint = cosyvoice.apiUrl || "http://127.0.0.1:50000/inference_zero_shot"
  const cosyPromptWav = cosyvoice.promptWav || defaultCosyPromptWav(cosyRoot)
  const cosyPromptText = cosyvoice.promptText || "You are a helpful assistant.<|endofprompt|>希望你以后能够做的比我还好呦。"
  if (cosyEndpoint) {
    checks.push({
      group: "cosyvoice",
      name: "CosyVoice API TCP",
      target: maskUrl(cosyEndpoint),
      required: true,
      run: async () => {
        const url = new URL(cosyEndpoint)
        const port = Number(url.port || (url.protocol === "https:" ? 443 : 80))
        return tcpCheck({ host: url.hostname, port, timeoutMs: args.timeoutMs })
      },
    })
    checks.push({
      group: "cosyvoice",
      name: "CosyVoice real TTS",
      target: maskUrl(cosyEndpoint),
      required: true,
      skip: args.quick ? "skipped by --quick" : null,
      run: async () => {
        if (!fileExists(cosyPromptWav)) throw new Error(`prompt wav missing: ${cosyPromptWav}`)
        return cosyVoiceTtsCheck({
          endpoint: cosyEndpoint,
          promptText: cosyPromptText,
          promptWav: cosyPromptWav,
          timeoutMs: HEAVY_TIMEOUT_MS,
        })
      },
    })
  }

  const chatModel = config.chatModel ?? config.chat_model ?? {}
  if (chatModel.baseUrl && chatModel.apiKey && chatModel.model) {
    checks.push({
      group: "model-api",
      name: "chatModel /models",
      target: maskUrl(resolveUrl(chatModel.baseUrl, "/models")),
      required: true,
      run: () => openAiModelsCheck({ baseUrl: chatModel.baseUrl, apiKey: chatModel.apiKey, timeoutMs: args.timeoutMs }),
    })
    checks.push({
      group: "model-api",
      name: "chatModel /responses",
      target: `${maskUrl(resolveUrl(chatModel.baseUrl, "/responses"))} model=${chatModel.model}`,
      required: true,
      skip: args.quick ? "skipped by --quick" : null,
      run: () => responsesCheck({
        baseUrl: chatModel.baseUrl,
        apiKey: chatModel.apiKey,
        model: chatModel.model,
        timeoutMs: Math.max(args.timeoutMs, 30000),
      }),
    })
  }

  const preferredMphPort = Number(process.env.MPH_PORT || 32036)
  const yamlMphPort = await readComsolLocalMphPort()
  checks.push({
    group: "comsol-mphserver",
    name: "COMSOL preferred private mphserver port state",
    target: makePortTarget("127.0.0.1", preferredMphPort),
    required: false,
    run: async () => {
      const ports = await discoverComsolMphPorts()
      if (ports.includes(preferredMphPort)) {
        await tcpCheck({ host: "127.0.0.1", port: preferredMphPort, timeoutMs: args.timeoutMs })
        return { message: `active mphserver on ${preferredMphPort}` }
      }
      const listening = await getListeningPorts()
      if (new RegExp(`:${preferredMphPort}\\s`, "u").test(listening)) {
        await tcpCheck({ host: "127.0.0.1", port: preferredMphPort, timeoutMs: args.timeoutMs })
        return { message: `port ${preferredMphPort} is listening` }
      }
      return { message: `no active mphserver on preferred port; runtime can allocate this private port` }
    },
  })
  if (yamlMphPort) {
    checks.push({
      group: "comsol-mphserver",
      name: "COMSOL configured local_mph_port state",
      target: makePortTarget("127.0.0.1", yamlMphPort),
      required: false,
      run: async () => {
        const ports = await discoverComsolMphPorts()
        if (ports.includes(yamlMphPort)) {
          await tcpCheck({ host: "127.0.0.1", port: yamlMphPort, timeoutMs: args.timeoutMs })
          return { message: `active mphserver on ${yamlMphPort}` }
        }
        return { message: `no active mphserver on configured local_mph_port ${yamlMphPort}` }
      },
    })
  }
  checks.push({
    group: "comsol-mphserver",
    name: "COMSOL active mphserver discovery",
    target: "pgrep/ss mphserver",
    required: args.requireComsolRuntime,
    run: async () => {
      const ports = await discoverComsolMphPorts()
      if (ports.length === 0) {
        if (args.requireComsolRuntime) throw new Error("no active COMSOL mphserver detected")
        return { message: "no active COMSOL mphserver detected; normal when no simulation is running" }
      }
      for (const port of ports) {
        await tcpCheck({ host: "127.0.0.1", port, timeoutMs: args.timeoutMs })
      }
      return { message: `active mphserver ports: ${ports.join(", ")}` }
    },
  })

  const funasr = config.funasr ?? {}
  if (funasr.apiUrl) {
    checks.push({
      group: "http-service",
      name: "FunASR transcription API",
      target: maskUrl(funasr.apiUrl),
      required: true,
      run: () => funAsrTranscriptionCheck({ endpoint: funasr.apiUrl, timeoutMs: Math.max(args.timeoutMs, 30000) }),
    })
  } else {
    checks.push({
      group: "config",
      name: "FunASR transcription API URL",
      target: "funasr.apiUrl",
      required: false,
      run: async () => ({ message: "funasr.apiUrl not configured" }),
    })
  }
  if (args.includeWeb) {
    const serverPort = config.server?.port
    if (serverPort) {
      checks.push({
        group: "web-self",
        name: "App backend /api/health",
        target: `http://127.0.0.1:${serverPort}/api/health`,
        required: true,
        run: () => httpCheck({ url: `http://127.0.0.1:${serverPort}/api/health`, timeoutMs: args.timeoutMs }),
      })
    }
    const frontendPort = config.frontend?.httpsPort || config.frontend?.port
    if (frontendPort) {
      checks.push({
        group: "web-self",
        name: "App frontend port",
        target: `127.0.0.1:${frontendPort}`,
        required: true,
        run: () => tcpCheck({ host: "127.0.0.1", port: frontendPort, timeoutMs: args.timeoutMs }),
      })
    }
  }

  return checks
}

function printResults(results, { configPath }) {
  const requiredFailures = results.filter((item) => item.required && !item.ok)
  const optionalFailures = results.filter((item) => !item.required && !item.ok)
  const skipped = results.filter((item) => item.skipped)

  console.log(`Config: ${configPath}`)
  console.log(`Checks: ${results.length}, required_failures=${requiredFailures.length}, optional_failures=${optionalFailures.length}, skipped=${skipped.length}`)
  console.log("")
  for (const result of results) {
    const status = result.skipped ? "SKIP" : result.ok ? "OK  " : result.required ? "FAIL" : "WARN"
    const required = result.required ? "required" : "optional"
    const duration = `${result.durationMs ?? 0}ms`.padStart(7)
    const message = result.ok ? result.message : result.error
    console.log(`${status} [${required}] [${result.group}] ${result.name}`)
    console.log(`     target: ${result.target}`)
    console.log(`     time:   ${duration}`)
    if (message) console.log(`     detail: ${message}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = await readJson(args.config)
  const checks = await buildChecks(config, args)
  const results = []
  for (const check of checks) {
    results.push(await runCheck(check))
  }

  if (args.json) {
    console.log(JSON.stringify({
      config: args.config,
      ok: results.every((item) => !item.required || item.ok),
      results: results.map(({ run, skip, ...item }) => item),
    }, null, 2))
  } else {
    printResults(results, { configPath: args.config })
  }

  const failed = results.some((item) => item.required && !item.ok)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(2)
})
