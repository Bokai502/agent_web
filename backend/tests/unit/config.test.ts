import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import type { ExecFileException } from "node:child_process"
import { describe, it } from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

function buildLoadConfigScript(configJson?: string | null) {
  if (configJson === undefined) {
    return [
      "import { loadConfig } from './src/config.ts';",
      "const config = loadConfig();",
      "console.log(JSON.stringify(config));",
    ].join("")
  }

  if (configJson === null) {
    return [
      "import fs from 'node:fs';",
      "const originalExistsSync = fs.existsSync.bind(fs);",
      "fs.existsSync = (file) => String(file).endsWith('/config.json') ? false : originalExistsSync(file);",
      "const { loadConfig } = await import('./src/config.ts');",
      "const config = loadConfig();",
      "console.log(JSON.stringify(config));",
    ].join("")
  }

  return [
    "import fs from 'node:fs';",
    `const fakeConfig = ${JSON.stringify(configJson)};`,
    "const originalExistsSync = fs.existsSync.bind(fs);",
    "const originalReadFileSync = fs.readFileSync.bind(fs);",
    "fs.existsSync = (file) => String(file).endsWith('/config.json') ? true : originalExistsSync(file);",
    "fs.readFileSync = (file, ...args) => String(file).endsWith('/config.json') ? fakeConfig : originalReadFileSync(file, ...args);",
    "const { loadConfig } = await import('./src/config.ts');",
    "const config = loadConfig();",
    "console.log(JSON.stringify(config));",
  ].join("")
}

async function loadConfigInChild(env: Record<string, string | undefined> = {}, configJson?: string | null) {
  const script = buildLoadConfigScript(configJson)
  const result = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    maxBuffer: 1024 * 1024,
  })
  return JSON.parse(result.stdout) as Record<string, any>
}

async function failLoadConfigInChild(env: Record<string, string | undefined>, configJson?: string | null) {
  try {
    await loadConfigInChild(env, configJson)
  } catch (err) {
    const childError = err as ExecFileException & { stderr?: string }
    return {
      code: childError.code,
      stderr: childError.stderr ?? "",
    }
  }
  assert.fail("expected loadConfig to exit with an error")
}

function minimalConfig(overrides: Record<string, any> = {}) {
  return {
    openai: {
      apiKey: "test-openai-key",
      baseUrl: "http://127.0.0.1:9999",
      model: "openai-model",
    },
    chatModel: {
      apiKey: "test-chat-key",
      baseUrl: "http://127.0.0.1:8888",
      model: "chat-model",
    },
    frontend: {
      httpsPort: 5174,
      port: 5173,
    },
    server: {
      port: 3001,
    },
    tools: {
      cad: {
        displayNum: "2",
        launcher: "/bin/true",
        noVncPort: 6081,
        vncPort: 5901,
      },
      comsol: {
        displayNum: "3",
        launcher: "/bin/true",
        noVncPort: 6082,
        vncPort: 5902,
      },
      paraview: {
        displayNum: "4",
        launcher: "/bin/true",
        noVncPort: 6083,
        vncPort: 5903,
      },
      remoteDesktopLauncher: "/bin/true",
    },
    workspace: {
      rpcHost: "127.0.0.1",
      rpcPort: 65000,
    },
    ...overrides,
  }
}

describe("loadConfig", () => {
  it("loads the project config with normalized defaults", async () => {
    const config = await loadConfigInChild()

    assert.equal(typeof config.chatModel.apiKey, "string")
    assert.equal(typeof config.chatModel.baseUrl, "string")
    assert.equal(typeof config.chatModel.model, "string")
    assert.equal(typeof config.server.port, "number")
    assert.equal(config.frontend.strictPort, true)
    assert.equal(config.tools.comsol.sudo, "sudo")
    assert.equal(Array.isArray(config.server.corsOrigin) || typeof config.server.corsOrigin === "string", true)
  })

  it("applies environment overrides for auth, model, workspace, funasr, and cosyvoice settings", async () => {
    const config = await loadConfigInChild({
      BACKEND_PORT: "4567",
      OPENAI_API_KEY: "env-openai-key",
      OPENAI_BASE_URL: "http://127.0.0.1:4569",
      CHAT_MODEL_API_KEY: "env-chat-key",
      CHAT_MODEL_BASE_URL: "http://127.0.0.1:4568",
      CHAT_MODEL_NAME: "env-chat-model",
      CODEX_AUTH_COOKIE_NAME: "env_cookie",
      CODEX_AUTH_ENABLED: "true",
      CODEX_AUTH_HEADER_NAME: "x-env-user",
      CODEX_DEV_USER_ID: "env-user",
      CODEX_USERS_DIR: "env-users",
      COSYVOICE_API_URL: "http://127.0.0.1:9000",
      COSYVOICE_PROMPT_TEXT: "Env voice",
      COSYVOICE_PROMPT_WAV: "/tmp/prompt.wav",
      COSYVOICE_ROOT: "/tmp/cosy",
      COSYVOICE_TTS_CACHE_MAX_ITEMS: "3",
      COSYVOICE_TTS_CACHE_TTL_MS: "4000",
      COSYVOICE_TTS_MAX_TEXT_LENGTH: "120",
      FUNASR_API_URL: "http://127.0.0.1:18080/v1/audio/transcriptions",
      WORKSPACE_FILE_PREVIEW_MAX_BYTES: "111",
      WORKSPACE_FILESYSTEM_GROUP: "env-group",
      WORKSPACE_TEXT_CHUNK_BYTES: "222",
      WORKSPACE_TEXT_CHUNK_MAX_BYTES: "333",
      WORKSPACE_TEXT_FILE_MAX_BYTES: "444",
    })

    assert.equal(config.auth.cookieName, "env_cookie")
    assert.equal(config.auth.devUserId, "env-user")
    assert.equal(config.auth.enabled, true)
    assert.equal(config.auth.headerName, "x-env-user")
    assert.equal(config.auth.usersDir, "env-users")
    assert.equal(config.openai.apiKey, "env-openai-key")
    assert.equal(config.openai.baseUrl, "http://127.0.0.1:4569")
    assert.equal(config.chatModel.apiKey, "env-chat-key")
    assert.equal(config.chatModel.baseUrl, "http://127.0.0.1:4568")
    assert.equal(config.chatModel.model, "env-chat-model")
    assert.equal(config.server.port, 4567)
    assert.equal(config.workspace.filesystemGroup, "env-group")
    assert.equal(config.workspace.filePreviewMaxBytes, 111)
    assert.equal(config.workspace.textChunkBytes, 222)
    assert.equal(config.workspace.textChunkMaxBytes, 333)
    assert.equal(config.workspace.textFileMaxBytes, 444)
    assert.deepEqual(config.funasr, {
      apiUrl: "http://127.0.0.1:18080/v1/audio/transcriptions",
    })
    assert.equal(config.cosyvoice.apiUrl, "http://127.0.0.1:9000")
    assert.equal(config.cosyvoice.promptText, "Env voice")
    assert.equal(config.cosyvoice.promptWav, "/tmp/prompt.wav")
    assert.equal(config.cosyvoice.root, "/tmp/cosy")
    assert.equal(config.cosyvoice.streamCacheMaxItems, 3)
    assert.equal(config.cosyvoice.streamCacheTtlMs, 4000)
    assert.equal(config.cosyvoice.ttsMaxTextLength, 120)
  })

  it("loads legacy config aliases, enum values, boolean strings, and default CORS origins", async () => {
    const config = await loadConfigInChild({}, JSON.stringify(minimalConfig({
      chatModel: undefined,
      chat_model: {
        api_key: "legacy-chat-key",
        base_url: "http://127.0.0.1:8888",
        model: "legacy-chat-model",
      },
      codex: {
        approvalPolicy: "on-request",
        modelReasoningEffort: "high",
        sandboxMode: "workspace-write",
        sandboxWorkspaceWriteNetworkAccess: "true",
        skipGitRepoCheck: "false",
      },
      frontend: {
        host: "frontend.local",
        httpsPort: 8443,
        port: 8080,
        publicHost: "public.local",
        strictPort: "false",
      },
      server: {
        port: 3001,
      },
      workspace: undefined,
      ["free" + "cad"]: {
        filePreviewMaxBytes: 123,
        rpcHost: "legacy-rpc",
        rpcPort: 65001,
        textChunkBytes: 456,
        textChunkMaxBytes: 789,
        textFileMaxBytes: 1024,
      },
    })))

    assert.equal(config.chatModel.apiKey, "legacy-chat-key")
    assert.equal(config.chatModel.baseUrl, "http://127.0.0.1:8888")
    assert.equal(config.codex.approvalPolicy, "on-request")
    assert.equal(config.codex.modelReasoningEffort, "high")
    assert.equal(config.codex.sandboxMode, "workspace-write")
    assert.equal(config.codex.sandboxWorkspaceWriteNetworkAccess, true)
    assert.equal(config.codex.skipGitRepoCheck, false)
    assert.equal(config.frontend.host, "frontend.local")
    assert.equal(config.frontend.publicHost, "public.local")
    assert.equal(config.frontend.strictPort, false)
    assert.deepEqual(config.server.corsOrigin, [
      "http://localhost:8080",
      "https://localhost:8443",
      "http://127.0.0.1:8080",
      "https://127.0.0.1:8443",
      "http://public.local:8080",
      "https://public.local:8443",
      "http://frontend.local:8080",
      "https://frontend.local:8443",
    ])
    assert.equal(config.workspace.rpcHost, "legacy-rpc")
    assert.equal(config.workspace.filePreviewMaxBytes, 123)
  })

  it("normalizes explicit CORS origins from strings and arrays", async () => {
    const stringCors = await loadConfigInChild({}, JSON.stringify(minimalConfig({
      server: {
        corsOrigin: "  http://example.test  ",
        port: 3001,
      },
    })))
    assert.equal(stringCors.server.corsOrigin, "http://example.test")

    const arrayCors = await loadConfigInChild({}, JSON.stringify(minimalConfig({
      server: {
        corsOrigin: ["", " http://one.test ", null, "http://two.test"],
        port: 3001,
      },
    })))
    assert.deepEqual(arrayCors.server.corsOrigin, ["http://one.test", "http://two.test"])

    const defaultCors = await loadConfigInChild({}, JSON.stringify(minimalConfig({
      frontend: {
        host: "0.0.0.0",
        httpsPort: 9443,
        port: 9080,
        publicHost: "localhost",
      },
    })))
    assert.deepEqual(defaultCors.server.corsOrigin, [
      "http://localhost:9080",
      "https://localhost:9443",
      "http://127.0.0.1:9080",
      "https://127.0.0.1:9443",
    ])
  })

  it("rejects invalid environment overrides before returning a config", async () => {
    const cases: Array<[Record<string, string | undefined>, RegExp]> = [
      [{ BACKEND_PORT: "0" }, /BACKEND_PORT 必须是正整数/u],
      [{ BACKEND_PORT: "1.5" }, /BACKEND_PORT 必须是正整数/u],
      [{ CHAT_MODEL_BASE_URL: "not a url" }, /chatModel\.baseUrl 不是合法 URL/u],
      [{ CHAT_MODEL_NAME: "" }, /chatModel\.model 未设置/u],
      [{ CODEX_AUTH_ENABLED: "maybe" }, /auth\.enabled 必须是布尔值/u],
      [{ WORKSPACE_TEXT_CHUNK_BYTES: "0" }, /workspace\.textChunkBytes 必须是正整数/u],
      [{ WORKSPACE_TEXT_FILE_MAX_BYTES: "NaN" }, /workspace\.textFileMaxBytes 必须是数字/u],
    ]

    for (const [env, message] of cases) {
      const result = await failLoadConfigInChild(env)

      assert.equal(result.code, 1)
      assert.match(result.stderr, message)
    }
  })

  it("rejects malformed config file values", async () => {
    const cases: Array<[Record<string, any> | string, RegExp]> = [
      ["{", /config\.json 不是合法 JSON/u],
      [minimalConfig({ openai: { apiKey: "   ", baseUrl: "http://127.0.0.1:9999" } }), /openai\.apiKey 未设置/u],
      [minimalConfig({ openai: { apiKey: "sk-REPLACE-ME", baseUrl: "http://127.0.0.1:9999" } }), /openai\.apiKey 仍是占位符/u],
      [minimalConfig({ openai: { apiKey: "test-openai-key", baseUrl: "" } }), /openai\.baseUrl 未设置/u],
      [minimalConfig({ openai: { apiKey: "test-openai-key", baseUrl: "notaurl" } }), /openai\.baseUrl 不是合法 URL/u],
      [minimalConfig({ openai: { apiKey: "test-openai-key", base_url: 1 } }), /openai\.base_url 必须是字符串/u],
      [minimalConfig({ codex: { supportsWebsockets: "maybe" } }), /codex\.supportsWebsockets 必须是布尔值/u],
      [minimalConfig({ frontend: { httpsPort: 5174, port: 0 } }), /frontend\.port 必须是正整数/u],
      [minimalConfig({ frontend: { httpsPort: 5174 } }), /frontend\.port 未设置/u],
      [minimalConfig({ frontend: { host: 123, httpsPort: 5174, port: 5173 } }), /frontend\.host 必须是字符串/u],
      [minimalConfig({ chatModel: { apiKey: "   ", model: "chat-model" } }), /chatModel\.apiKey 未设置/u],
      [minimalConfig({ chatModel: { baseUrl: "", model: "chat-model" } }), /chatModel\.baseUrl 未设置/u],
      [minimalConfig({ chatModel: { baseUrl: "notaurl", model: "chat-model" } }), /chatModel\.baseUrl 不是合法 URL/u],
      [minimalConfig({ chatModel: { base_url: 1, model: "chat-model" } }), /chatModel\.base_url 必须是字符串/u],
      [minimalConfig({ codex: { approvalPolicy: "always" } }), /codex\.approvalPolicy 必须是以下值之一/u],
      [minimalConfig({ codex: { modelReasoningEffort: 1 } }), /codex\.modelReasoningEffort 必须是字符串/u],
      [minimalConfig({ server: { corsOrigin: "   ", port: 3001 } }), /server\.corsOrigin 不能为空字符串/u],
      [minimalConfig({ server: { corsOrigin: ["", 123], port: 3001 } }), /server\.corsOrigin 数组不能为空/u],
      [minimalConfig({ server: { corsOrigin: 42, port: 3001 } }), /server\.corsOrigin 必须是字符串或字符串数组/u],
      [minimalConfig({ tools: { cad: {}, comsol: {}, paraview: {} } }), /tools\.remoteDesktopLauncher 未设置/u],
      [minimalConfig({ tools: { cad: { launcher: "/bin/true" }, comsol: {}, paraview: {}, remoteDesktopLauncher: "/bin/true" } }), /tools\.cad\.displayNum 未设置/u],
      [minimalConfig({ workspace: { rpcPort: 65000 } }), /workspace\.rpcHost 未设置/u],
      [minimalConfig({ workspace: { rpcHost: "127.0.0.1" } }), /workspace\.rpcPort 未设置/u],
    ]

    for (const [configInput, message] of cases) {
      const configJson = typeof configInput === "string" ? configInput : JSON.stringify(configInput)
      const result = await failLoadConfigInChild({}, configJson)

      assert.equal(result.code, 1)
      assert.match(result.stderr, message)
    }
  })

  it("rejects missing config files before reading JSON", async () => {
    const result = await failLoadConfigInChild({}, null)

    assert.equal(result.code, 1)
    assert.match(result.stderr, /配置文件不存在/u)
    assert.match(result.stderr, /open_codex_web\/config\.json/u)
  })
})
