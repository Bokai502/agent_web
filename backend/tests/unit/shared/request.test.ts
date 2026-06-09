import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { getObject, getString } from "../../../src/shared/request.js"

describe("shared request helpers", () => {
  it("returns trimmed strings and null for non-strings or blanks", () => {
    assert.equal(getString("  hello  "), "hello")
    assert.equal(getString(" \t\n "), null)
    assert.equal(getString(123), null)
    assert.equal(getString(null), null)
  })

  it("returns plain records and rejects arrays or nullish values", () => {
    const object = { ok: true }

    assert.equal(getObject(object), object)
    assert.equal(getObject([]), undefined)
    assert.equal(getObject(null), undefined)
    assert.equal(getObject("object"), undefined)
  })
})
