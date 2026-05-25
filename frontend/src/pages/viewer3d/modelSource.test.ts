import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchResolvedModel } from "./modelSource"

describe("fetchResolvedModel", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("does not fall back to an unscoped model when a scoped lookup has no model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchResolvedModel(
      {
        autoRefresh: true,
        lookupUrl: "/api/workspace/model?sessionId=missing-session&variant=original",
        variant: "original",
      },
      new AbortController().signal,
    )

    expect(result).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspace/model?sessionId=missing-session&variant=original",
      expect.objectContaining({ cache: "no-store" }),
    )
  })
})
