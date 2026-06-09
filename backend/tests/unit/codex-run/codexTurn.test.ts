import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { Writable } from "node:stream"
import {
  RunRequestError,
  appendTerminalIfMissing,
  getTerminalStatus,
  hasTerminalEvent,
  prepareCodexTurn,
  resolveCodexClientEvent,
} from "../../../src/codex-run/codexTurn.js"
import { runWithRequestContext } from "../../../src/server/requestContext.js"
import { createTestConfig } from "../../helpers/testConfig.js"
import { createTestLogger } from "../../helpers/testLogger.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"
import {
  createManifestFixture,
  installNoopWorkspaceCommands,
  userRoot,
} from "../../helpers/manifestFixture.js"

function workspaceDir() {
  return path.join(userRoot(), "workspaces", "ws_prepare", "versions", "v0001")
}

async function writeSkill(root: string, dir: string, name: string, body = "Skill body") {
  const skillDir = path.join(root, dir)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: ${name} description`,
    "---",
    body,
  ].join("\n"), "utf-8")
}

async function withWorkspaceContext<T>(callback: () => Promise<T>) {
  return await runWithRequestContext({
    userId: "default",
    userWorkspaceRoot: userRoot(),
    workspaceRootOverride: userRoot(),
  }, callback)
}

function createRecordingLogger() {
  const entries: Array<{ level: string; message: string; meta: unknown }> = []
  const record = (level: string) => (message: string, meta?: unknown) => {
    entries.push({ level, message, meta })
  }

  return {
    entries,
    logger: {
      debug: record("debug"),
      error: record("error"),
      info: record("info"),
      warn: record("warn"),
      stream: new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        },
      }),
    },
  }
}

describe("prepareCodexTurn", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await createManifestFixture("ws_prepare")
    delete process.env.CODEX_WEB_SKILLS_DIRS
  })

  it("rejects requests without prompt/input, sessionId, or turnId", async () => {
    const config = createTestConfig()
    const logger = createTestLogger()

    await assert.rejects(
      prepareCodexTurn({ sessionId: "session-1", turnId: "turn-1" }, { config, logger }),
      (error: unknown) => error instanceof RunRequestError &&
        error.statusCode === 400 &&
        error.message === "prompt or input is required",
    )

    await assert.rejects(
      prepareCodexTurn({ prompt: "hello", turnId: "turn-1" }, { config, logger }),
      (error: unknown) => error instanceof RunRequestError &&
        error.statusCode === 400 &&
        error.message === "sessionId is required",
    )

    await assert.rejects(
      prepareCodexTurn({ prompt: "hello", sessionId: "session-1" }, { config, logger }),
      (error: unknown) => error instanceof RunRequestError &&
        error.statusCode === 400 &&
        error.message === "turnId is required",
    )
  })

  it("rejects missing explicit and selected skills", async () => {
    const config = createTestConfig()
    const logger = createTestLogger()

    await assert.rejects(
      prepareCodexTurn({
        enabledSkills: ["missing-skill"],
        prompt: "hello",
        sessionId: "session-1",
        turnId: "turn-1",
      }, { config, forcedSkillScopes: ["public"], logger }),
      (error: unknown) => error instanceof RunRequestError &&
        error.statusCode === 400 &&
        error.message === "enabled skill not found: missing-skill",
    )

    await assert.rejects(
      prepareCodexTurn({
        prompt: "hello",
        sessionId: "session-1",
        turnId: "turn-1",
      }, {
        config,
        forcedSkillScopes: ["public"],
        logger,
        selectedSkillNames: ["missing-auto-skill"],
      }),
      (error: unknown) => error instanceof RunRequestError &&
        error.statusCode === 500 &&
        error.message === "selected skill not found: missing-auto-skill",
    )
  })

  it("prepares a run with extra skills and workspace context", async () => {
    const config = createTestConfig()
    const logger = createTestLogger()

    const prepared = await withWorkspaceContext(async () => await prepareCodexTurn({
      input: [
        { type: "text", text: "  task from input  " },
        { type: "local_image", path: " /tmp/image.png " },
      ],
      prompt: "  ",
      sessionId: " session-1 ",
      threadId: " thread-1 ",
      turnId: " turn-1 ",
      workspaceDir: workspaceDir(),
      workspaceId: "ws_prepare",
      workspaceName: "Prepare Workspace",
    }, {
      config,
      extraSkillInstructions: [
        {
          content: "Extra skill body",
          description: "Extra skill",
          file: "/tmp/extra/SKILL.md",
          name: "extra-skill",
        },
      ],
      forcedSkillScopes: ["public"],
      logger,
      requestId: "request-1",
      routingIntent: "test-intent",
    }))

    assert.equal(prepared.runContext.sessionId, "session-1")
    assert.equal(prepared.runContext.turnId, "turn-1")
    assert.equal(prepared.runContext.threadId, "thread-1")
    assert.equal(prepared.runContext.workspaceDir, workspaceDir())
    assert.equal(prepared.effectiveWorkingDirectory, workspaceDir())
    assert.equal(prepared.promptTextForHistory, "task from input")
    assert.equal(prepared.requestId, "request-1")
    assert.match(prepared.manifestRunId ?? "", /^run_/u)
    assert.equal(Array.isArray(prepared.sdkInput), true)
    assert.match(JSON.stringify(prepared.sdkInput), /extra-skill/u)
  })

  it("prepares skill-only runs and selected auto skills", async () => {
    const skillsRoot = path.join(TEST_DATA_ROOT, "skills")
    await writeSkill(skillsRoot, "explicit", "explicit-skill", "Explicit skill instructions")
    await writeSkill(skillsRoot, "auto", "auto-skill", "Auto skill instructions")
    process.env.CODEX_WEB_SKILLS_DIRS = skillsRoot
    const config = createTestConfig()
    const logger = createTestLogger()

    const skillOnly = await prepareCodexTurn({
      enabledSkills: [" explicit-skill "],
      sessionId: "skill-session",
      turnId: "skill-turn",
    }, {
      config,
      forcedSkillScopes: ["public"],
      logger,
    })

    assert.deepEqual(skillOnly.enabledSkills, ["explicit-skill"])
    assert.equal(skillOnly.promptTextForHistory, "[input]")
    assert.equal(Array.isArray(skillOnly.sdkInput), true)
    assert.match(JSON.stringify(skillOnly.sdkInput), /Explicit skill instructions/u)

    const selected = await prepareCodexTurn({
      prompt: "selected prompt",
      sessionId: "selected-session",
      turnId: "selected-turn",
    }, {
      config,
      forcedSkillScopes: ["public"],
      logger,
      selectedSkillNames: [" auto-skill ", ""],
    })

    assert.deepEqual(selected.enabledSkills, [])
    assert.equal(selected.promptTextForHistory, "selected prompt")
    assert.match(JSON.stringify(selected.sdkInput), /Auto skill instructions/u)
  })

  it("returns a 409 RunRequestError for mismatched workspace locators", async () => {
    const config = createTestConfig()
    const logger = createTestLogger()

    await withWorkspaceContext(async () => {
      await assert.rejects(
        prepareCodexTurn({
          prompt: "hello",
          sessionId: "session-1",
          turnId: "turn-1",
          workspaceDir: workspaceDir(),
          workspaceId: "ws_other",
        }, {
          config,
          logger,
        }),
        (error: unknown) => error instanceof RunRequestError &&
          error.statusCode === 409 &&
          /workspaceId does not match resolved manifest/u.test(error.message),
      )
    })
  })

  it("uses the resolved default workspace root when no explicit workspace context is provided", async () => {
    const templateDir = path.join(TEST_DATA_ROOT, "template")
    await fs.mkdir(templateDir, { recursive: true })
    const config = createTestConfig({ workspace: { templateDir } })
    const logger = createTestLogger()

    const prepared = await withWorkspaceContext(async () => await prepareCodexTurn({
      prompt: "hello without workspace",
      sessionId: "session-no-workspace",
      turnId: "turn-no-workspace",
      workspaceName: "Loose Workspace",
    }, {
      config,
      forcedSkillScopes: ["public"],
      logger,
    }))

    assert.equal(prepared.runContext.workspaceDir, userRoot())
    assert.equal(prepared.runContext.workspaceId, null)
    assert.equal(prepared.effectiveWorkingDirectory, userRoot())
    assert.equal(prepared.manifestRunId, null)
    assert.equal(prepared.requestedWorkspaceName, "Loose Workspace")
  })

  it("rejects blank skill-only requests when no skill instructions resolve", async () => {
    const config = createTestConfig()
    const logger = createTestLogger()

    await assert.rejects(
      prepareCodexTurn({
        enabledSkills: ["", "   "],
        sessionId: "blank-skill-session",
        turnId: "blank-skill-turn",
      }, {
        config,
        forcedSkillScopes: ["public"],
        logger,
      }),
      (error: unknown) => error instanceof RunRequestError &&
        error.statusCode === 400 &&
        error.message === "prompt or input is required",
    )
  })

  it("logs manifest persistence failures without rejecting the run", async () => {
    const { logger, entries } = createRecordingLogger()
    const config = createTestConfig()

    const prepared = await withWorkspaceContext(async () => await prepareCodexTurn({
        prompt: "hello despite persistence failure",
        sessionId: "session-persist-fails",
        turnId: "turn-persist-fails",
      }, {
        config,
        forcedSkillScopes: ["public"],
        logger,
        requestId: "request-persist-fails",
      }))

    assert.equal(prepared.runContext.workspaceDir, userRoot())
    assert.equal(prepared.runContext.workspaceId, null)
    assert.equal(prepared.manifestRunId, null)
    assert.equal(prepared.promptTextForHistory, "hello despite persistence failure")
    assert.equal(entries.some(entry => entry.level === "error" && entry.message === "manifest run create failed"), true)
    assert.equal(entries.some(entry => entry.level === "info" && entry.message === "codex run accepted"), true)
  })
})

describe("codex turn event helpers", () => {
  it("detects terminal events and derives terminal statuses", () => {
    assert.equal(hasTerminalEvent([]), false)
    assert.equal(hasTerminalEvent([{ type: "item.completed" }]), false)
    assert.equal(hasTerminalEvent([{ type: "turn.completed" }]), true)
    assert.equal(hasTerminalEvent([{ type: "turn.failed" }]), true)
    assert.equal(hasTerminalEvent([{ type: "error" }]), true)

    assert.equal(getTerminalStatus([{ type: "turn.completed" }], false), "completed")
    assert.equal(getTerminalStatus([{ type: "turn.failed" }], false), "failed")
    assert.equal(getTerminalStatus([{ type: "error" }], false), "failed")
    assert.equal(getTerminalStatus([{ type: "turn.completed" }], true), "cancelled")
  })

  it("appends a terminal failure only when streamed events are non-empty and unfinished", () => {
    const emptyEvents: unknown[] = []
    appendTerminalIfMissing(emptyEvents, "empty")
    assert.deepEqual(emptyEvents, [])

    const completedEvents: unknown[] = [{ type: "turn.completed" }]
    appendTerminalIfMissing(completedEvents, "already done")
    assert.deepEqual(completedEvents, [{ type: "turn.completed" }])

    const unfinishedEvents: unknown[] = [{ type: "item.completed" }]
    appendTerminalIfMissing(unfinishedEvents, "interrupted")
    assert.deepEqual(unfinishedEvents, [
      { type: "item.completed" },
      { type: "turn.failed", error: { message: "interrupted" } },
    ])
  })

  it("converts completed ask-user agent messages into client ask-user events", () => {
    const suppressed = new Set<string>()
    const decision = resolveCodexClientEvent({
      type: "item.completed",
      item: {
        id: "agent-ask",
        type: "agent_message",
        text: [
          "<ask-user-question>",
          "<question>请选择下一步？</question>",
          "<option>继续</option>",
          "<option>停止</option>",
          "</ask-user-question>",
        ].join(""),
      },
    }, suppressed)

    assert.equal(decision.persistOnly, true)
    assert.deepEqual(decision.clientEvent, {
      type: "item.completed",
      item: {
        id: "ask_user:agent-ask",
        type: "ask_user",
        question: "请选择下一步？",
        options: ["继续", "停止"],
      },
    })
    assert.equal(suppressed.has("agent-ask"), true)
  })

  it("suppresses partial ask-user and empty agent message events until completion", () => {
    const suppressed = new Set<string>()

    assert.deepEqual(resolveCodexClientEvent({
      type: "item.started",
      item: { id: "empty-agent", type: "agent_message", text: "   " },
    }, suppressed), { clientEvent: null, persistOnly: true })

    assert.deepEqual(resolveCodexClientEvent({
      type: "item.updated",
      item: { id: "partial-ask", type: "agent_message", text: "<ask-user-question><question>等" },
    }, suppressed), { clientEvent: null, persistOnly: true })
    assert.equal(suppressed.has("partial-ask"), true)

    const completed = {
      type: "item.completed",
      item: { id: "partial-ask", type: "agent_message", text: "普通最终回答" },
    }
    assert.deepEqual(resolveCodexClientEvent(completed, suppressed), {
      clientEvent: completed,
      persistOnly: false,
    })
    assert.equal(suppressed.has("partial-ask"), false)
  })

  it("passes through non-agent-message events unchanged", () => {
    const suppressed = new Set<string>()
    const event = {
      type: "item.completed",
      item: { id: "tool-1", type: "tool_call", text: "<ask-user-question>" },
    }

    assert.deepEqual(resolveCodexClientEvent(event, suppressed), {
      clientEvent: event,
      persistOnly: false,
    })
    assert.equal(suppressed.size, 0)
  })
})
