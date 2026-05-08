import { useEffect, useRef, useState } from "react"
import * as THREE from "three/webgpu"
import {
  bumpMap,
  cameraPosition,
  color,
  max,
  mix,
  normalWorldGeometry,
  normalize,
  output,
  positionWorld,
  step,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

const INIT_ERROR = "Earth 页面初始化失败。请确认浏览器支持 WebGL2；若需启用 WebGPU，请使用 HTTPS 或 localhost 访问，并查看控制台错误。"
const EARTH_TILT = -Math.PI / 7.6
const ORBIT_SEGMENTS = 192
const ORBIT_TUBE_RADIUS = 0.0005
const SATELLITE_SCALE = 0.2

const TEXTURE_PATHS = {
  day: "/textures/earth/earth_day_4096.jpg",
  night: "/textures/earth/earth_night_4096.jpg",
  bump: "/textures/earth/earth_bump_roughness_clouds_4096.jpg",
}

type Disposable = { dispose: () => void }
type WebGPURendererRuntime = {
  init: () => Promise<void>
  setPixelRatio: (value: number) => void
  setSize: (width: number, height: number) => void
  setAnimationLoop: (callback: (() => void) | null) => void
  render: (scene: THREE.Scene, camera: THREE.Camera) => void
  dispose: () => void
  domElement: HTMLCanvasElement
  backend?: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean }
}
type MeshStandardNodeMaterialRuntime = THREE.MeshStandardMaterial & {
  colorNode: unknown
  roughnessNode: unknown
  outputNode: unknown
  normalNode: unknown
}
type MeshBasicNodeMaterialRuntime = THREE.MeshBasicMaterial & {
  outputNode: unknown
}
type SatelliteMotion = {
  angle: number
  mesh: THREE.Group
  radiusX: number
  radiusZ: number
  spinSpeed: number
  speed: number
}
type SatelliteBuild = {
  group: THREE.Group
  resources: Disposable[]
}

function createOrbitPoints(radiusX: number, radiusZ: number, segments = ORBIT_SEGMENTS) {
  const points: THREE.Vector3[] = []

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    points.push(
      new THREE.Vector3(
        Math.cos(angle) * radiusX,
        0,
        Math.sin(angle) * radiusZ,
      ),
    )
  }

  return points
}

function createSatellite(bodyColor: THREE.ColorRepresentation, panelColor: THREE.ColorRepresentation): SatelliteBuild {
  const group = new THREE.Group()
  const resources: Disposable[] = []

  const bodyGeometry = new THREE.BoxGeometry(0.09, 0.09, 0.14)
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    emissive: bodyColor,
    emissiveIntensity: 0.22,
    metalness: 0.82,
    roughness: 0.32,
  })
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  group.add(body)

  const panelGeometry = new THREE.BoxGeometry(0.18, 0.012, 0.08)
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: panelColor,
    emissive: panelColor,
    emissiveIntensity: 0.35,
    metalness: 0.45,
    roughness: 0.5,
  })
  const leftPanel = new THREE.Mesh(panelGeometry, panelMaterial)
  leftPanel.position.x = -0.15
  group.add(leftPanel)

  const rightPanel = new THREE.Mesh(panelGeometry, panelMaterial)
  rightPanel.position.x = 0.15
  group.add(rightPanel)

  const antennaGeometry = new THREE.CylinderGeometry(0.008, 0.008, 0.13, 12)
  const antennaMaterial = new THREE.MeshStandardMaterial({
    color: "#d8e6ff",
    metalness: 0.7,
    roughness: 0.28,
  })
  const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial)
  antenna.rotation.z = Math.PI / 2
  antenna.position.set(0, 0.045, 0)
  group.add(antenna)

  const beaconGeometry = new THREE.SphereGeometry(0.024, 12, 12)
  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: "#f7fbff",
    emissive: panelColor,
    emissiveIntensity: 0.5,
    metalness: 0.25,
    roughness: 0.18,
  })
  const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial)
  beacon.position.set(0, 0.03, 0.09)
  group.add(beacon)

  resources.push(
    bodyGeometry,
    bodyMaterial,
    panelGeometry,
    panelMaterial,
    antennaGeometry,
    antennaMaterial,
    beaconGeometry,
    beaconMaterial,
  )

  group.scale.setScalar(SATELLITE_SCALE)

  return { group, resources }
}

function updateSatellitePose(satellite: SatelliteMotion) {
  const x = Math.cos(satellite.angle) * satellite.radiusX
  const z = Math.sin(satellite.angle) * satellite.radiusZ

  satellite.mesh.position.set(x, 0, z)
  satellite.mesh.rotation.y = satellite.angle + Math.PI / 2
  satellite.mesh.rotation.x = Math.sin(satellite.angle * 2) * 0.08
}

export default function EarthPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const mount = mountRef.current

    if (!mount) return

    let disposed = false
    let renderer: WebGPURendererRuntime | null = null
    let controls: OrbitControls | null = null
    let animationGroup: THREE.Group | null = null
    let domElement: HTMLCanvasElement | null = null
    const disposableResources: Disposable[] = []
    const satelliteMotions: SatelliteMotion[] = []

    const handleResize = (camera: THREE.PerspectiveCamera) => {
      if (!renderer) return
      const width = mount.clientWidth || window.innerWidth
      const height = mount.clientHeight || window.innerHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }

    const init = async () => {
      const width = mount.clientWidth || window.innerWidth
      const height = mount.clientHeight || window.innerHeight

      const nextRenderer = new THREE.WebGPURenderer({ antialias: true, alpha: false }) as unknown as WebGPURendererRuntime
      renderer = nextRenderer
      await nextRenderer.init()

      if (nextRenderer.backend?.isWebGLBackend) {
        console.info("Earth renderer fallback: WebGPU unavailable in current context, running with WebGL2 backend.")
      }

      if (disposed) {
        nextRenderer.dispose()
        return
      }

      nextRenderer.setPixelRatio(window.devicePixelRatio)
      nextRenderer.setSize(width, height)
      const canvas = nextRenderer.domElement
      domElement = canvas
      mount.appendChild(canvas)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x000000)

      const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 100)
      camera.position.set(4.5, 2, 3)

      const sun = new THREE.DirectionalLight("#ffffff", 2)
      sun.position.set(0, 0, 3)
      scene.add(sun)

      const atmosphereDayColor = uniform(color("#4db2ff"))
      const atmosphereTwilightColor = uniform(color("#bc490b"))
      const roughnessLow = uniform(0.25)
      const roughnessHigh = uniform(0.35)

      const textureLoader = new THREE.TextureLoader()
      const dayTexture = textureLoader.load(TEXTURE_PATHS.day)
      dayTexture.colorSpace = THREE.SRGBColorSpace
      dayTexture.anisotropy = 8

      const nightTexture = textureLoader.load(TEXTURE_PATHS.night)
      nightTexture.colorSpace = THREE.SRGBColorSpace
      nightTexture.anisotropy = 8

      const bumpTexture = textureLoader.load(TEXTURE_PATHS.bump)
      bumpTexture.anisotropy = 8

      disposableResources.push(dayTexture, nightTexture, bumpTexture)

      const viewDirection = positionWorld.sub(cameraPosition).normalize()
      const fresnel = viewDirection.dot(normalWorldGeometry).abs().oneMinus().toVar()
      const sunOrientation = normalWorldGeometry.dot(normalize(sun.position)).toVar()
      const atmosphereColor = mix(
        atmosphereTwilightColor,
        atmosphereDayColor,
        sunOrientation.smoothstep(-0.25, 0.75),
      )

      const globeMaterial = new THREE.MeshStandardNodeMaterial() as unknown as MeshStandardNodeMaterialRuntime
      const cloudsStrength = texture(bumpTexture, uv()).b.smoothstep(0.2, 1)
      globeMaterial.colorNode = mix(texture(dayTexture), vec3(1), cloudsStrength.mul(2))

      const roughness = max(
        texture(bumpTexture).g,
        step(0.01, cloudsStrength),
      )
      globeMaterial.roughnessNode = roughness.remap(0, 1, roughnessLow, roughnessHigh)

      const night = texture(nightTexture)
      const dayStrength = sunOrientation.smoothstep(-0.25, 0.5)
      const atmosphereDayStrength = sunOrientation.smoothstep(-0.5, 1)
      const atmosphereMix = atmosphereDayStrength.mul(fresnel.pow(2)).clamp(0, 1)

      let finalOutput = mix(night.rgb, output.rgb, dayStrength)
      finalOutput = mix(finalOutput, atmosphereColor, atmosphereMix)
      globeMaterial.outputNode = vec4(finalOutput, output.a)

      const bumpElevation = max(texture(bumpTexture).r, cloudsStrength)
      globeMaterial.normalNode = bumpMap(bumpElevation)

      const sphereGeometry = new THREE.SphereGeometry(1, 64, 64)
      const globe = new THREE.Mesh(sphereGeometry, globeMaterial)

      const atmosphereMaterial = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        transparent: true,
      }) as unknown as MeshBasicNodeMaterialRuntime
      let alpha = fresnel.remap(0.73, 1, 1, 0).pow(3)
      alpha = alpha.mul(sunOrientation.smoothstep(-0.5, 1))
      atmosphereMaterial.outputNode = vec4(atmosphereColor, alpha)

      const atmosphere = new THREE.Mesh(sphereGeometry, atmosphereMaterial)
      atmosphere.scale.setScalar(1.04)

      disposableResources.push(sphereGeometry, globeMaterial, atmosphereMaterial)

      const earthGroup = new THREE.Group()
      earthGroup.rotateX(EARTH_TILT)
      earthGroup.add(globe)
      earthGroup.add(atmosphere)
      scene.add(earthGroup)
      animationGroup = earthGroup

      const orbitSystem = new THREE.Group()
      orbitSystem.rotation.x = EARTH_TILT
      scene.add(orbitSystem)

      const addSatelliteOrbit = ({
        bodyColor,
        orbitColor,
        panelColor,
        phase,
        radiusX,
        radiusZ,
        speed,
        spinSpeed,
        tiltX,
        tiltY,
        tiltZ = 0,
      }: {
        bodyColor: THREE.ColorRepresentation
        orbitColor: THREE.ColorRepresentation
        panelColor: THREE.ColorRepresentation
        phase: number
        radiusX: number
        radiusZ: number
        speed: number
        spinSpeed: number
        tiltX: number
        tiltY: number
        tiltZ?: number
      }) => {
        const orbitGroup = new THREE.Group()
        orbitGroup.rotation.set(tiltX, tiltY, tiltZ)

        const orbitCurve = new THREE.CatmullRomCurve3(createOrbitPoints(radiusX, radiusZ), true)
        const orbitGeometry = new THREE.TubeGeometry(
          orbitCurve,
          ORBIT_SEGMENTS,
          ORBIT_TUBE_RADIUS,
          12,
          true,
        )
        const orbitMaterial = new THREE.MeshBasicMaterial({
          color: orbitColor,
          opacity: 0.72,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
        const orbitMesh = new THREE.Mesh(orbitGeometry, orbitMaterial)
        orbitGroup.add(orbitMesh)

        const satellite = createSatellite(bodyColor, panelColor)
        orbitGroup.add(satellite.group)

        const motion: SatelliteMotion = {
          angle: phase,
          mesh: satellite.group,
          radiusX,
          radiusZ,
          spinSpeed,
          speed,
        }

        updateSatellitePose(motion)
        satelliteMotions.push(motion)
        orbitSystem.add(orbitGroup)
        disposableResources.push(orbitGeometry, orbitMaterial, ...satellite.resources)
      }

      addSatelliteOrbit({
        bodyColor: "#d8ecff",
        orbitColor: "#74d4ff",
        panelColor: "#5d8bff",
        phase: 0.8,
        radiusX: 1.7,
        radiusZ: 1.38,
        speed: 0.85,
        spinSpeed: 1.35,
        tiltX: 0.55,
        tiltY: 0.15,
      })

      addSatelliteOrbit({
        bodyColor: "#ffe3b3",
        orbitColor: "#ffbf6e",
        panelColor: "#ff8a4c",
        phase: 2.7,
        radiusX: 2.2,
        radiusZ: 1.75,
        speed: -0.58,
        spinSpeed: -0.95,
        tiltX: -0.9,
        tiltY: 1.05,
        tiltZ: 0.18,
      })

      controls = new OrbitControls(camera, nextRenderer.domElement)
      controls.enableDamping = true
      controls.minDistance = 0.1
      controls.maxDistance = 50

      let previousTime = performance.now()
      const onResize = () => handleResize(camera)
      window.addEventListener("resize", onResize)

      nextRenderer.setAnimationLoop(() => {
        if (disposed || !animationGroup) return
        const currentTime = performance.now()
        const delta = (currentTime - previousTime) / 1000
        previousTime = currentTime
        animationGroup.rotation.y += delta * 0.06

        satelliteMotions.forEach((satellite) => {
          satellite.angle += delta * satellite.speed
          updateSatellitePose(satellite)
          satellite.mesh.rotation.z += delta * satellite.spinSpeed
        })

        controls?.update()
        nextRenderer.render(scene, camera)
      })

      return () => {
        window.removeEventListener("resize", onResize)
      }
    }

    let disposeResize: (() => void) | undefined

    init()
      .then((cleanup) => {
        disposeResize = cleanup
      })
      .catch((error: unknown) => {
        console.error("Earth init error:", error)
        setErrorMessage(INIT_ERROR)
      })

    return () => {
      disposed = true
      disposeResize?.()
      controls?.dispose()
      renderer?.setAnimationLoop(null)
      renderer?.dispose()
      disposableResources.forEach((resource) => resource.dispose())
      if (mount && domElement && mount.contains(domElement)) {
        mount.removeChild(domElement)
      }
    }
  }, [])

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#000", position: "relative" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)",
      }}>
        <span style={{ color: "#c8d8ff", fontFamily: "system-ui", fontSize: 15, fontWeight: 600, letterSpacing: "0.04em" }}>
          WebGPU Earth
        </span>
        <a href="/" style={{
          color: "#90caf9", fontFamily: "system-ui", fontSize: 13,
          textDecoration: "none",
          padding: "4px 12px", borderRadius: 6,
          border: "1px solid rgba(144,202,249,0.3)",
          background: "rgba(0,0,0,0.35)",
        }}>
          ← Back
        </a>
      </div>

      <div style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
        color: "rgba(180,200,255,0.7)", fontFamily: "system-ui", fontSize: 12,
        background: "rgba(0,0,0,0.35)", padding: "6px 16px", borderRadius: 20,
        whiteSpace: "nowrap",
      }}>
        左键旋转 · 右键平移 · 滚轮缩放
      </div>

      {errorMessage && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24,
          background: "rgba(0,0,0,0.78)",
        }}>
          <div style={{
            maxWidth: 520,
            color: "#e6edf7",
            fontFamily: "system-ui",
            fontSize: 15,
            lineHeight: 1.6,
            textAlign: "center",
            background: "rgba(12,16,24,0.92)",
            border: "1px solid rgba(120,160,255,0.24)",
            borderRadius: 14,
            padding: "20px 24px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          }}>
            {errorMessage}
          </div>
        </div>
      )}
    </div>
  )
}
