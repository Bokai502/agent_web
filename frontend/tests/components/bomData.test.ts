import { describe, expect, it } from "vitest"
import { parseBomInfo } from "../../src/components/bomData"

describe("parseBomInfo", () => {
  it("reads component counts and top-level component IDs from enhanced BOM data", () => {
    const parsed = parseBomInfo({
      schema_version: "1.0",
      bom_id: "sample-bom",
      total_records: 45,
      matched_records: 45,
      missing_records: 0,
      components: [
        {
          component_id: "P022",
          semantic_name: "THM-013",
          quantity: 1,
          display_info: {
            model: "TC-THERMAL-STRAP-THERMAL-LINK",
            semantic_name: "THM-013",
          },
        },
      ],
    })

    expect(parsed.totalRecords).toBe(45)
    expect(parsed.components[0].componentId).toBe("P022")
    expect(parsed.components[0].semanticName).toBe("THM-013")
  })

  it("falls back to real_bom items when components are absent", () => {
    const parsed = parseBomInfo({
      schema_version: "1.0",
      bom_id: "real-bom",
      items: [
        {
          component_id: "P000",
          semantic_name: "PWR-004",
          quantity: 1,
          component_subtype: "battery",
        },
        {
          component_id: "P023",
          semantic_name: "THM-014",
          quantity: 1,
          component_subtype: "heat_pipe",
        },
      ],
    })

    expect(parsed.totalRecords).toBe(2)
    expect(parsed.matchedRecords).toBe(2)
    expect(parsed.components.map(component => component.componentId)).toEqual(["P000", "P023"])
  })
})
