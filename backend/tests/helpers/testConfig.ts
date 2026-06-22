import path from "node:path"
import type { AppConfig } from "../../src/config.js"

export function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataRoot = path.resolve(process.cwd(), "..", "data", "input_data")
  const tmpRoot = process.env.CODEX_WEB_TEST_ROOT
    ? path.resolve(process.env.CODEX_WEB_TEST_ROOT)
    : path.resolve(process.cwd(), "..", "..", "tmp", `open-codex-web-tests-${process.pid}`)

  const config: AppConfig = {
    auth: {
      cookieName: "codex_user_id",
      devUserId: "default",
      enabled: false,
      headerName: "x-codex-user-id",
      usersDir: path.join(tmpRoot, "users"),
    },
    codex: {
      approvalPolicy: "never",
      modelReasoningEffort: "medium",
      modelProvider: null,
      modelProviderName: null,
      sandboxMode: "workspace-write",
      sandboxWorkspaceWriteNetworkAccess: false,
      skipGitRepoCheck: true,
      supportsWebsockets: null,
      wireApi: null,
    },
    cosyvoice: {
      apiUrl: null,
      promptText: null,
      promptWav: null,
      root: null,
      streamCacheMaxItems: 64,
      streamCacheTtlMs: 600000,
      ttsMaxTextLength: 5000,
    },
    frontend: {
      host: "127.0.0.1",
      httpsPort: 5174,
      port: 5173,
      publicHost: null,
      strictPort: true,
    },
    logging: {
      alsoStdout: false,
      file: path.join(tmpRoot, "logs", "test.log"),
      level: "error",
    },
    openai: {
      apiKey: "test-openai-api-key",
      baseUrl: "http://127.0.0.1:9",
      model: "test-openai-model",
    },
    chatModel: {
      apiKey: "test-chat-api-key",
      baseUrl: "http://127.0.0.1:9",
      model: "test-chat-model",
      responsesCompat: null,
    },
    compliance: {
      database: {
        host: "127.0.0.1",
        port: "9",
        user: "postgres",
        password: "postgres",
        catalog: {
          db: "components_db",
          recallLimitPerComponent: 80,
        },
        reliability: {
          db: "satllm_db",
          schema: "staging",
          limitPerComponent: 5,
        },
      },
    },
    server: {
      corsOrigin: "http://localhost:5173",
      host: "127.0.0.1",
      port: 0,
    },
    tools: {
      remoteDesktopLauncher: "/bin/true",
      cad: {
        bin: null,
        displayNum: "2",
        launcher: "/bin/true",
        noVncPort: 6081,
        vncPort: 5902,
      },
      comsol: {
        displayNum: "3",
        launcher: "/bin/true",
        noVncPort: 6082,
        sudo: "sudo",
        vncPort: 5903,
      },
      gnc: {
        url: null,
      },
      paraview: {
        displayNum: "4",
        launcher: "/bin/true",
        noVncPort: 6083,
        vncPort: 5904,
      },
    },
    funasr: {
      apiUrl: null,
    },
    workspace: {
      filePreviewMaxBytes: 1024 * 1024,
      filesystemGroup: "test",
      rpcHost: "127.0.0.1",
      rpcPort: 65535,
      templateDir: dataRoot,
      textChunkBytes: 512 * 1024,
      textChunkMaxBytes: 1024 * 1024,
      textFileMaxBytes: 8 * 1024 * 1024,
      usersRoot: path.join(tmpRoot, "users"),
    },
  }

  return {
    ...config,
    ...overrides,
    auth: { ...config.auth, ...overrides.auth },
    codex: { ...config.codex, ...overrides.codex },
    cosyvoice: { ...config.cosyvoice, ...overrides.cosyvoice },
    frontend: { ...config.frontend, ...overrides.frontend },
    logging: { ...config.logging, ...overrides.logging },
    openai: { ...config.openai, ...overrides.openai },
    chatModel: { ...config.chatModel, ...overrides.chatModel },
    compliance: {
      ...config.compliance,
      ...overrides.compliance,
      database: {
        ...config.compliance.database,
        ...overrides.compliance?.database,
        catalog: {
          ...config.compliance.database.catalog,
          ...overrides.compliance?.database?.catalog,
        },
        reliability: {
          ...config.compliance.database.reliability,
          ...overrides.compliance?.database?.reliability,
        },
      },
    },
    server: { ...config.server, ...overrides.server },
    tools: {
      ...config.tools,
      ...overrides.tools,
      cad: { ...config.tools.cad, ...overrides.tools?.cad },
      comsol: { ...config.tools.comsol, ...overrides.tools?.comsol },
      gnc: { ...config.tools.gnc, ...overrides.tools?.gnc },
      paraview: { ...config.tools.paraview, ...overrides.tools?.paraview },
    },
    funasr: { ...config.funasr, ...overrides.funasr },
    workspace: { ...config.workspace, ...overrides.workspace },
  }
}
