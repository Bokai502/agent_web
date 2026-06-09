import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ASK_USER_TAG_START,
  extractAskUserPayload,
} from "../../../src/codex-run/askUserProtocol.js"

describe("ask-user protocol helpers", () => {
  it("extracts questions and deduplicated options from ask-user XML", () => {
    const payload = extractAskUserPayload([
      "  <ask-user-question>",
      "<question>  请选择 工况  </question>",
      "<option>热分析</option>",
      "<option>热分析</option>",
      "<option>结构分析</option>",
      "<option>多余选项</option>",
      "</ask-user-question>  ",
    ].join("\n"))

    assert.deepEqual(payload, {
      question: "请选择 工况",
      options: ["热分析", "结构分析", "多余选项"],
    })
  })

  it("falls back to tag-stripped body text and rejects non-protocol text", () => {
    assert.equal(ASK_USER_TAG_START.test("  <ask-user-question>"), true)
    assert.deepEqual(extractAskUserPayload([
      "<ask-user-question>",
      "缺少 question 标签时使用正文",
      "<option> A </option>",
      "</ask-user-question>",
    ].join("\n")), {
      question: "缺少 question 标签时使用正文 A",
      options: ["A"],
    })
    assert.equal(extractAskUserPayload("plain text"), null)
    assert.equal(extractAskUserPayload("<ask-user-question><question> </question></ask-user-question>"), null)
  })
})
