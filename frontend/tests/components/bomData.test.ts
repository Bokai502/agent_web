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

  it("reads CATCH display fields from real_bom source_ref", () => {
    const parsed = parseBomInfo({
      schema_version: "1.0",
      bom_id: "catch-bom",
      items: [
        {
          component_id: "P001",
          semantic_name: "catch_catch_p001_星箭分离机构_WF50",
          component_subtype: "separation_device",
          material_id: "aluminum_6061",
          mass_kg: 1.370495,
          power_W: 0,
          quantity: 1,
          size_mm: [312.264, 312.264, 65.07],
          source_ref: {
            cad_path: "/tmp/CATCH-P001_WF50.step",
            display_name: "星箭分离机构 WF50",
            panel_mount_face_id: "01_DIBAN_BJ.zmin_outer",
            source: "catch01_sl_decomposition",
            template_model: "catch_catch_p001_星箭分离机构_WF50",
          },
        },
      ],
    })

    expect(parsed.components[0].componentId).toBe("P001")
    expect(parsed.components[0].nameCn).toBe("星箭分离机构 WF50")
    expect(parsed.components[0].model).toBe("catch_catch_p001_星箭分离机构_WF50")
    expect(parsed.components[0].kind).toBe("separation_device")
    expect(parsed.components[0].material).toBe("aluminum_6061")
    expect(parsed.components[0].mountFace).toBe("01_DIBAN_BJ.zmin_outer")
    expect(parsed.components[0].cadPath).toBe("/tmp/CATCH-P001_WF50.step")
  })
})
