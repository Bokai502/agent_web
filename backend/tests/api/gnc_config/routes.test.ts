import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"

function userRoot() {
  return path.join(TEST_DATA_ROOT, "users", "default")
}

async function createGncWorkspace(name = "gnc_case") {
  const workspaceDir = path.join(userRoot(), name)
  const inputsDir = path.join(workspaceDir, "00_inputs")
  await fs.mkdir(inputsDir, { recursive: true })
  return { workspaceDir, inputsDir }
}

async function createGncFixtureWorkspace(name = "gnc_fixture_case") {
  const { workspaceDir, inputsDir } = await createGncWorkspace(name)
  const fixtureConfigDir = path.resolve(process.cwd(), "..", "data", "input_data", "gnc", "00_inputs", "Config")
  await fs.cp(fixtureConfigDir, path.join(inputsDir, "Config"), { recursive: true })
  return { workspaceDir, inputsDir, configDir: path.join(inputsDir, "Config") }
}

describe("GNC config routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await fs.mkdir(userRoot(), { recursive: true })
  })

  it("uses the Config subdirectory when Inp_Sim.txt exists there", async () => {
    const { workspaceDir, inputsDir } = await createGncWorkspace()
    const configDir = path.join(inputsDir, "Config")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(path.join(configDir, "Inp_Sim.txt"), "FAST\n", "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/gnc-config?workspaceDir=${encodeURIComponent(workspaceDir)}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 500)
      assert.match(body.error, /Unexpected EOF while parsing GNC config/u)
    } finally {
      await server.close()
    }
  })

  it("supports the legacy /api/gnc/gnc-config alias", async () => {
    const { workspaceDir, inputsDir } = await createGncWorkspace()
    await fs.writeFile(path.join(inputsDir, "Inp_Sim.txt"), "FAST\n", "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/gnc/gnc-config?workspaceDir=${encodeURIComponent(workspaceDir)}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 500)
      assert.match(body.error, /Unexpected EOF while parsing GNC config/u)
    } finally {
      await server.close()
    }
  })

  it("loads a complete GNC config fixture", async () => {
    const { workspaceDir, configDir } = await createGncFixtureWorkspace()
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/gnc-config?workspaceDir=${encodeURIComponent(workspaceDir)}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.workspace_dir, workspaceDir)
      assert.equal(body.source_dir, configDir)
      assert.equal(body.payload.sim.time_mode, "FAST")
      assert.equal(body.payload.sim.stop_time_s, 20000)
      assert.equal(body.payload.sim.reference_orbits.length, 1)
      assert.equal(body.payload.sim.spacecraft.length, 2)
      assert.equal(body.payload.orbits[0].description, "Low Earth Orbit")
      assert.equal(body.payload.orbits[0].central.world, "EARTH")
      assert.equal(body.payload.spacecraft[0].label, "S/C 0")
      assert.equal(body.payload.spacecraft[0].bodies.length, 2)
      assert.equal(body.payload.resolution.orbit_files_from_sim[0], path.join(configDir, "Orb_LEO.txt"))
    } finally {
      await server.close()
    }
  })

  it("saves edited GNC config payloads and preserves comments", async () => {
    const { workspaceDir, configDir } = await createGncFixtureWorkspace("gnc_save_case")
    const server = await createTestServer()

    try {
      const loadResponse = await server.inject({
        method: "GET",
        url: `/api/gnc-config?workspaceDir=${encodeURIComponent(workspaceDir)}`,
      })
      assert.equal(loadResponse.statusCode, 200)
      const payload = loadResponse.json().payload
      payload.sim.stop_time_s = 1234.5
      payload.sim.gl_enable = false
      payload.orbits[0].description = "EditedOrbit"
      payload.orbits[0].central.kep.inclination_deg = 42
      payload.spacecraft[0].label = "EditedSat"
      payload.spacecraft[0].bodies[0].mass_kg = 777

      const saveResponse = await server.inject({
        method: "PUT",
        payload: { payload, workspaceDir },
        url: "/api/gnc-config",
      })
      const body = saveResponse.json()

      assert.equal(saveResponse.statusCode, 200)
      assert.equal(body.payload.sim.stop_time_s, 1234.5)
      assert.equal(body.payload.sim.gl_enable, false)
      assert.equal(body.payload.orbits[0].description, "EditedOrbit")
      assert.equal(body.payload.orbits[0].central.kep.inclination_deg, 42)
      assert.equal(body.payload.spacecraft[0].label, "EditedSat")
      assert.equal(body.payload.spacecraft[0].bodies[0].mass_kg, 777)

      const simText = await fs.readFile(path.join(configDir, "Inp_Sim.txt"), "utf-8")
      const orbitText = await fs.readFile(path.join(configDir, "Orb_LEO.txt"), "utf-8")
      const spacecraftText = await fs.readFile(path.join(configDir, "SC_CfsSat0.txt"), "utf-8")
      assert.match(simText, /1234\.5  0\.01\s+!  Sim Duration/u)
      assert.match(simText, /FALSE\s+!  Graphics Front End/u)
      assert.match(orbitText, /EditedOrbit\s+!  Description/u)
      assert.match(orbitText, /42\s+!  Inclination/u)
      assert.match(spacecraftText, /EditedSat\s+!  Label/u)
      assert.match(spacecraftText, /777\s+! Mass/u)
    } finally {
      await server.close()
    }
  })

  it("supports the legacy save alias and rejects unsafe referenced config files", async () => {
    const { workspaceDir, configDir } = await createGncFixtureWorkspace("gnc_legacy_save_case")
    const server = await createTestServer()

    try {
      const loadResponse = await server.inject({
        method: "GET",
        url: `/api/gnc-config?workspaceDir=${encodeURIComponent(workspaceDir)}`,
      })
      assert.equal(loadResponse.statusCode, 200)
      const payload = loadResponse.json().payload
      payload.sim.rng_seed = 2468

      const legacySave = await server.inject({
        method: "PUT",
        payload: { payload, workspaceDir },
        url: "/api/gnc/gnc-config",
      })
      assert.equal(legacySave.statusCode, 200)
      assert.equal(legacySave.json().payload.sim.rng_seed, 2468)
      assert.match(await fs.readFile(path.join(configDir, "Inp_Sim.txt"), "utf-8"), /2468\s+!  RNG Seed/u)

      payload.orbits[0].file = "../escape.txt"
      const unsafeOrbitFile = await server.inject({
        method: "PUT",
        payload: { payload, workspaceDir },
        url: "/api/gnc-config",
      })
      assert.equal(unsafeOrbitFile.statusCode, 500)
      assert.match(unsafeOrbitFile.json().error, /Config reference escapes config directory: \.\.\/escape\.txt/u)
    } finally {
      await server.close()
    }
  })

  it("rejects save requests without a payload", async () => {
    const { workspaceDir } = await createGncWorkspace()
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "PUT",
        payload: { workspaceDir },
        url: "/api/gnc-config",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "payload is required" })

      const nonObjectPayload = await server.inject({
        method: "PUT",
        payload: { payload: "not-an-object", workspaceDir },
        url: "/api/gnc-config",
      })
      assert.equal(nonObjectPayload.statusCode, 500)
      assert.deepEqual(nonObjectPayload.json(), { error: "payload must be an object" })
    } finally {
      await server.close()
    }
  })

  it("reports workspace query errors for missing workspaces", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: "/api/gnc-config?workspaceId=missing_case",
      })
      const body = response.json()

      assert.equal(response.statusCode, 500)
      assert.match(body.error, /workspaceId does not match resolved manifest|Workspace not found|workspace path does not exist/u)
    } finally {
      await server.close()
    }
  })
})
