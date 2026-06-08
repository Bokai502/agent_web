import { useEffect, useRef, useState } from "react"
import * as THREE from "three/webgpu"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DeratingMissingItemsPanel } from "./DeratingMissingItemsPanel"
import {
  ANNOTATION_PALETTES,
  DEFAULT_ANNOTATION_HEIGHT,
  DEFAULT_ANNOTATION_WIDTH,
  collectComponentRoots,
  createAnnotationLabel,
  distributeLabelTops,
  measureAnnotationLabel,
  resolveComponentLabel,
} from "./viewer3d/annotations"
import {
  fetchResolvedModel,
  buildViewerModelSource,
  getModelVariantFromUrl,
  getModelVersion,
  getVariantDisplayName,
} from "./viewer3d/modelSource"
import {
  addLightweightMeshEdges,
  applyLightweightPreviewStyle,
  disposeModelResources,
  loadGltf,
} from "./viewer3d/modelUtils"
import type { Disposable, PartAnnotation, ResolvedModel, WebGPURendererRuntime } from "./viewer3d/types"

const MAX_DEVICE_PIXEL_RATIO = 1.25
const ANNOTATION_MAX_TRACKS_PER_SIDE = 3
const ANNOTATION_TRACK_GAP = 10

type ComponentDetail = {
  componentId: string
  dimensions: string
  kind: string
  semanticName: string
  subsystem: string
}

type RawComponentInfo = {
  components?: Array<{
    category?: unknown
    component_id?: unknown
    component_subtype?: unknown
    kind?: unknown
    semantic_name?: unknown
    size_mm?: unknown
    display_info?: {
      dimensions?: unknown
      kind?: unknown
      semantic_name?: unknown
      subsystem?: unknown
    }
  }>
  items?: RawComponentInfo["components"]
}

type ViewerComponentMessage = {
  componentId?: unknown
  semanticName?: unknown
  type?: unknown
}

type ViewerMode = "cad" | "temperature" | "derating"

type TemperatureField = {
  attributes?: {
    color_rgb?: unknown
    position?: unknown
    temperature_K?: unknown
  }
  bounds?: {
    max?: unknown
    min?: unknown
  }
  point_count?: unknown
  temperature_range_K?: {
    max?: unknown
    min?: unknown
  }
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "-"
}

function formatSize(value: unknown) {
  return Array.isArray(value) && value.length > 0
    ? value.map(item => typeof item === "number" && Number.isFinite(item) ? Number(item.toFixed(3)) : item).join(" x ")
    : "-"
}

function parseComponentDetails(data: RawComponentInfo) {
  const detailsById: Record<string, ComponentDetail> = {}

  const components = Array.isArray(data.components) ? data.components : Array.isArray(data.items) ? data.items : []
  components.forEach((component) => {
    const componentId = asText(component.component_id)
    if (componentId === "-") return

    detailsById[componentId] = {
      componentId,
      dimensions: asText(component.display_info?.dimensions) !== "-"
        ? asText(component.display_info?.dimensions)
        : formatSize(component.size_mm),
      kind: asText(component.display_info?.kind) !== "-"
        ? asText(component.display_info?.kind)
        : asText(component.kind ?? component.category ?? component.component_subtype),
      semanticName: asText(component.display_info?.semantic_name ?? component.semantic_name),
      subsystem: asText(component.display_info?.subsystem),
    }
  })

  return detailsById
}

function mapBodyXyzToViewerPositions(positions: number[]) {
  const mapped: number[] = []
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]
    const y = positions[index + 1]
    const z = positions[index + 2]
    mapped.push(x, z, -y)
  }
  return mapped
}

function shouldShowDeratingMode(params: URLSearchParams, values: string[]) {
  const explicit = params.get("showDerating") ?? params.get("derating")
  if (explicit) return /^(1|true|yes)$/iu.test(explicit)

  const context = values.join(" ").toLowerCase()
  return context.includes("derating") || context.includes("ws_check") || context.includes("check_outputs")
}

function getViewerTheme(params: URLSearchParams): "dark" | "light" {
  const explicit = params.get("theme")?.trim().toLowerCase()
  if (explicit === "light") return "light"
  if (explicit === "dark") return "dark"
  return window.localStorage.getItem("agent-theme") === "light" ? "light" : "dark"
}

export default function ModelViewerPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const axisSvgRef = useRef<SVGSVGElement>(null)
  const annotationSvgRef = useRef<SVGSVGElement>(null)
  const annotationLabelsRef = useRef<HTMLDivElement>(null)
  const componentDetailsRef = useRef<Record<string, ComponentDetail>>({})
  const modelVariant = getModelVariantFromUrl()
  const pageParams = new URLSearchParams(window.location.search)
  const sessionId = pageParams.get("sessionId")?.trim() ?? ""
  const versionId = pageParams.get("versionId")?.trim() ?? ""
  const workspaceDir = pageParams.get("workspaceDir")?.trim() ?? ""
  const workspaceId = pageParams.get("workspaceId")?.trim() ?? ""
  const workspaceKey = pageParams.get("workspaceKey")?.trim() ?? ""
  const showDeratingMode = shouldShowDeratingMode(pageParams, [sessionId, versionId, workspaceDir, workspaceId, workspaceKey])
  const viewerTheme = getViewerTheme(pageParams)
  const [selectedComponent, setSelectedComponent] = useState<ComponentDetail | null>(null)
  const [statusMessage, setStatusMessage] = useState("Resolving CAD geometry...")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [viewerMode, setViewerMode] = useState<ViewerMode>("cad")
  const [temperatureRange, setTemperatureRange] = useState<{ max: number; min: number } | null>(null)
  const viewerModeRef = useRef<ViewerMode>("cad")

  useEffect(() => {
    viewerModeRef.current = viewerMode
  }, [viewerMode])

  useEffect(() => {
    if (showDeratingMode && viewerMode !== "derating") {
      setViewerMode("derating")
      return
    }
    if (!showDeratingMode && viewerMode === "derating") setViewerMode("cad")
  }, [showDeratingMode, viewerMode])

  useEffect(() => {
    if (import.meta.env.MODE === "test") return

    const controller = new AbortController()

    const loadComponentDetails = async () => {
      const queryParams = new URLSearchParams()
      if (sessionId) queryParams.set("sessionId", sessionId)
      if (workspaceId) queryParams.set("workspaceId", workspaceId)
      if (versionId) queryParams.set("versionId", versionId)
      if (workspaceDir) queryParams.set("workspaceDir", workspaceDir)
      const query = queryParams.toString() ? `?${queryParams.toString()}` : ""
      return fetch(`/api/workspace/bom${query}`, {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => response.ok ? response.json() as Promise<RawComponentInfo> : null)
        .catch(() => null)
    }

    loadComponentDetails()
      .then((data) => {
        if (!data) return
        componentDetailsRef.current = parseComponentDetails(data)
      })
      .catch(() => {
        // Component details are an optional overlay enhancement.
      })

    return () => controller.abort()
  }, [sessionId, versionId, workspaceDir, workspaceId])

  useEffect(() => {
    const mount = mountRef.current
    const axisSvg = axisSvgRef.current
    const annotationSvg = annotationSvgRef.current
    const annotationLabels = annotationLabelsRef.current

    if (!mount || !axisSvg || !annotationSvg || !annotationLabels) return

    let disposed = false
    let renderer: WebGPURendererRuntime | null = null
    let controls: OrbitControls | null = null
    let domElement: HTMLCanvasElement | null = null
    let modelRoot: THREE.Object3D | null = null
    let temperatureRoot: THREE.Points | null = null
    let temperatureFieldLoaded = false
    let temperatureFieldLoading = false
    let loadingMesh: THREE.Mesh | null = null
    let currentModelVersion: string | null = null
    let modelRefreshInFlight = false
    let lookupInterval: ReturnType<typeof setInterval> | null = null
    const modelRequest = new AbortController()
    const disposableResources: Disposable[] = []
    const annotations: PartAnnotation[] = []
    const componentRootsById = new Map<string, THREE.Object3D>()
    const originalMaterialsByMesh = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    const originalRenderOrderByMesh = new Map<THREE.Mesh, number>()
    const highlightMaterials = new Set<THREE.Material>()
    const screenPoint = new THREE.Vector3()
    const cameraSpacePoint = new THREE.Vector3()
    const axisDirection = new THREE.Vector3()
    const cameraInverse = new THREE.Quaternion()
    let annotationsNeedLayout = false
    let renderRequested = true
    let highlightedComponentId: string | null = null

    const requestRender = () => {
      renderRequested = true
    }

    const setSceneMode = (mode: ViewerMode) => {
      if (modelRoot) modelRoot.visible = mode === "cad"
      if (temperatureRoot) temperatureRoot.visible = mode === "temperature"
      annotationLabels.style.display = mode === "cad" ? "block" : "none"
      annotationSvg.style.display = mode === "cad" ? "block" : "none"
      if (domElement) domElement.style.display = mode === "derating" ? "none" : "block"
      axisSvg.style.display = mode === "derating" ? "none" : "block"
      if (mode !== "cad") {
        clearModelHighlight()
        setSelectedComponent(null)
      }
      markAnnotationsDirty()
      requestRender()
    }

    const markAnnotationsDirty = () => {
      annotationsNeedLayout = true
      requestRender()
    }

    const hideAnnotation = (annotation: PartAnnotation) => {
      annotation.labelEl.style.opacity = "0"
      annotation.labelEl.style.transform = "translate(-9999px, -9999px)"
      annotation.lineEl.style.display = "none"
      annotation.dotEl.style.display = "none"
    }

    const clearAnnotations = () => {
      annotations.splice(0, annotations.length)
      annotationsNeedLayout = false
      annotationLabels.replaceChildren()
      annotationSvg.replaceChildren()
    }

    const buildTemperatureFieldUrl = () => {
      const queryParams = new URLSearchParams()
      if (workspaceId) queryParams.set("workspaceId", workspaceId)
      if (versionId) queryParams.set("versionId", versionId)
      if (workspaceDir) queryParams.set("workspaceDir", workspaceDir)
      const query = queryParams.toString()
      return `/api/workspace/temperature-field${query ? `?${query}` : ""}`
    }

    const parseNumericArray = (value: unknown) => (
      Array.isArray(value)
        ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
        : []
    )

    const loadTemperatureField = async (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
      if (temperatureFieldLoaded || temperatureFieldLoading) return
      temperatureFieldLoading = true
      setStatusMessage("Loading temperature field...")
      try {
        const response = await fetch(buildTemperatureFieldUrl(), {
          cache: "no-store",
          signal: modelRequest.signal,
        })
        if (!response.ok) throw new Error("Temperature field result is unavailable.")
        const data = await response.json() as TemperatureField
        const positions = parseNumericArray(data.attributes?.position)
        const colors = parseNumericArray(data.attributes?.color_rgb)
        const temperatures = parseNumericArray(data.attributes?.temperature_K)
        if (positions.length < 3 || positions.length % 3 !== 0) {
          throw new Error("Temperature field has no renderable points.")
        }
        if (colors.length !== positions.length) {
          throw new Error("Temperature field color data is incomplete.")
        }
        const viewerPositions = mapBodyXyzToViewerPositions(positions)

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(viewerPositions, 3))
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
        geometry.computeBoundingBox()

        const material = new THREE.PointsMaterial({
          size: 0.018,
          sizeAttenuation: true,
          vertexColors: true,
        })
        const points = new THREE.Points(geometry, material)
        points.visible = viewerModeRef.current === "temperature"

        const box = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = maxDim > 0 ? 3.5 / maxDim : 1
        points.scale.setScalar(scale)
        points.position.sub(center.multiplyScalar(scale))
        const groundedBox = new THREE.Box3().setFromObject(points)
        points.position.y -= groundedBox.min.y

        temperatureRoot = points
        temperatureFieldLoaded = true
        const tempMin = typeof data.temperature_range_K?.min === "number"
          ? data.temperature_range_K.min
          : temperatures.length ? Math.min(...temperatures) : 0
        const tempMax = typeof data.temperature_range_K?.max === "number"
          ? data.temperature_range_K.max
          : temperatures.length ? Math.max(...temperatures) : 0
        setTemperatureRange({ max: tempMax, min: tempMin })
        scene.add(points)

        const sphere = new THREE.Sphere()
        new THREE.Box3().setFromObject(points).getBoundingSphere(sphere)
        const radius = Math.max(sphere.radius, 0.2)
        if (viewerModeRef.current === "temperature") {
          camera.position.set(
            sphere.center.x + radius * 2.2,
            sphere.center.y + radius * 1.4,
            sphere.center.z + radius * 2.2,
          )
          controls?.target.copy(sphere.center)
          controls?.update()
        }
        setStatusMessage("")
        setSceneMode(viewerModeRef.current)
        requestRender()
      } catch (error) {
        if (disposed || modelRequest.signal.aborted) return
        setErrorMessage(error instanceof Error ? error.message : "Temperature field load failed.")
        if (viewerModeRef.current === "temperature") setStatusMessage("")
      } finally {
        temperatureFieldLoading = false
      }
    }

    const updateAxisOverlay = (camera: THREE.PerspectiveCamera) => {
      camera.getWorldQuaternion(cameraInverse).invert()

      const origin = { x: 28, y: 62 }
      const axisLength = 34
      const axes = [
        { key: "x", vector: new THREE.Vector3(1, 0, 0) },
        { key: "y", vector: new THREE.Vector3(0, 0, -1) },
        { key: "z", vector: new THREE.Vector3(0, 1, 0) },
      ]

      axes.forEach(({ key, vector }) => {
        axisDirection.copy(vector).applyQuaternion(cameraInverse).normalize()
        const depthScale = 0.68 + Math.max(axisDirection.z, -0.6) * 0.18
        const endX = origin.x + axisDirection.x * axisLength * depthScale
        const endY = origin.y - axisDirection.y * axisLength * depthScale
        const labelX = origin.x + axisDirection.x * (axisLength + 10) * depthScale
        const labelY = origin.y - axisDirection.y * (axisLength + 10) * depthScale

        const line = axisSvg.querySelector<SVGLineElement>(`[data-axis-line="${key}"]`)
        const label = axisSvg.querySelector<SVGTextElement>(`[data-axis-label="${key}"]`)
        if (!line || !label) return

        line.setAttribute("x1", `${origin.x}`)
        line.setAttribute("y1", `${origin.y}`)
        line.setAttribute("x2", `${endX}`)
        line.setAttribute("y2", `${endY}`)
        label.setAttribute("x", `${labelX}`)
        label.setAttribute("y", `${labelY}`)
      })
    }

    const setAnnotationActiveState = (componentId: string | null) => {
      annotations.forEach((annotation) => {
        const active = annotation.componentId === componentId
        annotation.labelEl.style.border = active
          ? "1px solid rgba(125, 211, 252, 0.86)"
          : "1px solid rgba(122, 148, 212, 0.42)"
        annotation.labelEl.style.boxShadow = active
          ? "0 0 0 2px rgba(56, 189, 248, 0.2), 0 18px 34px rgba(14, 165, 233, 0.2)"
          : "0 12px 28px rgba(3, 8, 20, 0.32)"
        annotation.labelEl.style.background = active
          ? "rgba(7, 26, 46, 0.92)"
          : annotation.labelEl.dataset.tint ?? "rgba(17, 24, 48, 0.76)"
        annotation.dotEl.setAttribute("r", active ? "6.2" : "4.2")
        annotation.dotEl.setAttribute("stroke-width", active ? "2" : "1")
      })
    }

    const clearModelHighlight = () => {
      originalMaterialsByMesh.forEach((material, mesh) => {
        mesh.material = material
        mesh.renderOrder = originalRenderOrderByMesh.get(mesh) ?? 1
      })
      originalMaterialsByMesh.clear()
      originalRenderOrderByMesh.clear()
      highlightMaterials.forEach((material) => material.dispose())
      highlightMaterials.clear()
      highlightedComponentId = null
      setAnnotationActiveState(null)
      requestRender()
    }

    const highlightComponent = (componentId: string) => {
      if (highlightedComponentId === componentId) return
      clearModelHighlight()

      const componentRoot = componentRootsById.get(componentId)
      if (!componentRoot) return

      const highlightMaterial = new THREE.MeshStandardMaterial({
        color: 0x49c8ff,
        emissive: 0x0d5f92,
        emissiveIntensity: 0.68,
        metalness: 0.08,
        opacity: 0.94,
        roughness: 0.32,
        transparent: true,
      })
      highlightMaterial.depthWrite = true
      highlightMaterials.add(highlightMaterial)

      componentRoot.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return

        originalMaterialsByMesh.set(mesh, mesh.material)
        originalRenderOrderByMesh.set(mesh, mesh.renderOrder)
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map(() => {
            const material = highlightMaterial.clone()
            highlightMaterials.add(material)
            return material
          })
        } else {
          mesh.material = highlightMaterial
        }
        mesh.renderOrder = 4
      })

      highlightedComponentId = componentId
      setAnnotationActiveState(componentId)
      requestRender()
    }

    const selectComponent = (componentId: string, notifyParent = true) => {
      const detail = componentDetailsRef.current[componentId] ?? {
        componentId,
        dimensions: "-",
        kind: "-",
        semanticName: componentId,
        subsystem: "-",
      }
      setSelectedComponent(detail)
      highlightComponent(componentId)

      if (notifyParent && window.parent !== window) {
        window.parent.postMessage({
          componentId,
          semanticName: detail.semanticName,
          type: "viewer3d:component-selected",
        }, window.location.origin)
      }
    }

    const handleComponentMessage = (event: MessageEvent<ViewerComponentMessage>) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "viewer3d:select-component") return
      if (typeof event.data.componentId !== "string") return
      selectComponent(event.data.componentId, false)
    }

    const refreshAnnotationMeasurements = () => {
      annotations.forEach((annotation) => {
        const { height, width } = measureAnnotationLabel(annotation.labelEl)
        annotation.height = height
        annotation.width = width
      })
      markAnnotationsDirty()
    }

    const syncCameraForAnnotations = (camera: THREE.PerspectiveCamera) => {
      camera.updateMatrixWorld(true)
    }

    const layoutAnnotations = (
      camera: THREE.PerspectiveCamera,
      force = false,
    ) => {
      if (!force && !annotationsNeedLayout) return
      if (annotations.length === 0) {
        annotationsNeedLayout = false
        return
      }

      const viewportWidth = mount.clientWidth
      const viewportHeight = mount.clientHeight
      if (viewportWidth <= 0 || viewportHeight <= 0) return

      syncCameraForAnnotations(camera)

      const safeTop = 84
      const safeBottom = viewportHeight - 52
      const sidePadding = viewportWidth < 700 ? 12 : 18
      const labelGap = 6

      annotationSvg.setAttribute("viewBox", `0 0 ${viewportWidth} ${viewportHeight}`)

      const visible = annotations
        .map((annotation) => {
          screenPoint.copy(annotation.anchorWorld).project(camera)
          cameraSpacePoint
            .copy(annotation.anchorWorld)
            .applyMatrix4(camera.matrixWorldInverse)

          if (
            screenPoint.z < -1 ||
            screenPoint.z > 1 ||
            screenPoint.x < -1.4 ||
            screenPoint.x > 1.4 ||
            screenPoint.y < -1.4 ||
            screenPoint.y > 1.4
          ) {
            hideAnnotation(annotation)
            return null
          }

          return {
            annotation,
            height: annotation.height,
            side: cameraSpacePoint.x < 0 ? "left" as const : "right" as const,
            screenX: (screenPoint.x * 0.5 + 0.5) * viewportWidth,
            screenY: (-screenPoint.y * 0.5 + 0.5) * viewportHeight,
            width: annotation.width,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)

      const leftItems = visible
        .filter((item) => item.side === "left")
        .sort((a, b) => a.screenY - b.screenY)
      const rightItems = visible
        .filter((item) => item.side === "right")
        .sort((a, b) => a.screenY - b.screenY)

      const applyLayout = (
        items: typeof leftItems,
        side: "left" | "right",
      ) => {
        if (items.length === 0) return

        const usableHeight = Math.max(safeBottom - safeTop, 1)
        const tallestItemHeight = Math.max(...items.map((item) => item.height))
        const singleTrackCapacity = Math.max(
          1,
          Math.floor((usableHeight + labelGap) / (tallestItemHeight + labelGap)),
        )
        const maxTrackCount = viewportWidth < 640 ? 2 : ANNOTATION_MAX_TRACKS_PER_SIDE
        const trackCount = Math.min(
          maxTrackCount,
          Math.max(1, Math.ceil(items.length / singleTrackCapacity)),
        )
        const tracks = Array.from({ length: trackCount }, () => [] as typeof items)
        items.forEach((item, index) => {
          tracks[index % trackCount].push(item)
        })

        const maxLabelWidth = Math.max(...items.map((item) => item.width))

        tracks.forEach((trackItems, trackIndex) => {
          const tops = distributeLabelTops(
            trackItems.map((item) => ({
              desiredTop: item.screenY - item.height * 0.5,
              height: item.height,
            })),
            safeTop,
            safeBottom,
            labelGap,
          )

          trackItems.forEach((item, index) => {
            const trackOffset = trackIndex * (maxLabelWidth + ANNOTATION_TRACK_GAP)
            const labelLeft =
              side === "left"
                ? sidePadding + trackOffset
                : viewportWidth - sidePadding - item.width - trackOffset
            const labelTop = tops[index]
            const labelCenterY = labelTop + item.height * 0.5
            const labelEdgeX =
              side === "left" ? labelLeft + item.width : labelLeft
            const elbowX =
              side === "left"
                ? Math.min(item.screenX - 18, labelEdgeX + 18 + trackIndex * 10)
                : Math.max(item.screenX + 18, labelEdgeX - 18 - trackIndex * 10)

            item.annotation.labelEl.style.opacity = "1"
            item.annotation.labelEl.style.transform = `translate(${labelLeft}px, ${labelTop}px)`

            item.annotation.lineEl.style.display = "block"
            item.annotation.lineEl.setAttribute(
              "points",
              `${item.screenX},${item.screenY} ${item.screenX},${labelCenterY} ${elbowX},${labelCenterY} ${labelEdgeX},${labelCenterY}`,
            )

            item.annotation.dotEl.style.display = "block"
            item.annotation.dotEl.setAttribute("cx", item.screenX.toFixed(2))
            item.annotation.dotEl.setAttribute("cy", item.screenY.toFixed(2))
          })
        })
      }

      applyLayout(leftItems, "left")
      applyLayout(rightItems, "right")
      annotationsNeedLayout = false
    }

    const buildAnnotations = (
      model: THREE.Object3D,
      camera: THREE.PerspectiveCamera,
    ) => {
      clearAnnotations()
      model.updateWorldMatrix(true, true)

      const componentRoots = collectComponentRoots(model)
      componentRootsById.clear()

      componentRoots
        .map((componentRoot) => ({
          label: resolveComponentLabel(componentRoot),
          node: componentRoot,
        }))
        .filter((component) => component.label.length > 0)
        .sort((left, right) => left.label.localeCompare(right.label))
        .forEach((component, index) => {
          const bounds = new THREE.Box3().setFromObject(component.node)
          if (bounds.isEmpty()) return

          const center = bounds.getCenter(new THREE.Vector3())
          const anchorWorld = new THREE.Vector3(center.x, bounds.max.y, center.z)
          const palette = ANNOTATION_PALETTES[index % ANNOTATION_PALETTES.length]
          const labelEl = createAnnotationLabel(component.label, palette)
          labelEl.dataset.tint = palette.tint
          const showDetails = () => {
            selectComponent(component.label)
          }
          labelEl.addEventListener("click", showDetails)
          labelEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              showDetails()
            }
          })

          const lineEl = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "polyline",
          )
          lineEl.setAttribute("fill", "none")
          lineEl.setAttribute("stroke", palette.line)
          lineEl.setAttribute("stroke-width", "1.4")
          lineEl.setAttribute("stroke-linecap", "round")
          lineEl.setAttribute("stroke-linejoin", "round")
          lineEl.style.display = "none"

          const dotEl = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
          )
          dotEl.setAttribute("r", "4.2")
          dotEl.setAttribute("fill", palette.dot)
          dotEl.setAttribute("stroke", "rgba(255, 255, 255, 0.95)")
          dotEl.setAttribute("stroke-width", "1")
          dotEl.style.display = "none"

          annotationLabels.appendChild(labelEl)
          annotationSvg.appendChild(lineEl)
          annotationSvg.appendChild(dotEl)
          componentRootsById.set(component.label, component.node)

          annotations.push({
            anchorWorld,
            componentId: component.label,
            dotEl,
            height: DEFAULT_ANNOTATION_HEIGHT,
            labelEl,
            lineEl,
            width: DEFAULT_ANNOTATION_WIDTH,
          })
        })

      refreshAnnotationMeasurements()
      layoutAnnotations(camera, true)
    }

    const init = async () => {
      const modelSource = buildViewerModelSource(modelVariant)
      if (!modelSource) {
        setErrorMessage("Viewer model source is unavailable.")
        setStatusMessage("")
        return
      }

      const width = mount.clientWidth
      const height = mount.clientHeight

      const nextRenderer = new THREE.WebGPURenderer({ antialias: true, alpha: false }) as unknown as WebGPURendererRuntime
      renderer = nextRenderer
      await nextRenderer.init()

      if (nextRenderer.backend?.isWebGLBackend) {
        console.info("Viewer3D renderer fallback: WebGPU unavailable in current context, running with WebGL2 backend.")
      }

      if (disposed) {
        nextRenderer.dispose()
        return
      }

      nextRenderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO),
      )
      nextRenderer.setSize(width, height)
      nextRenderer.shadowMap.enabled = false
      nextRenderer.outputColorSpace = THREE.SRGBColorSpace
      nextRenderer.toneMapping = THREE.NoToneMapping
      nextRenderer.toneMappingExposure = 1
      domElement = nextRenderer.domElement
      mount.appendChild(nextRenderer.domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x111318)

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000)
      camera.position.set(3, 2, 5)

      const grid = new THREE.GridHelper(30, 30, 0xd8dde6, 0x2d323a)
      grid.material.transparent = true
      grid.material.opacity = 0.22
      scene.add(grid)

      controls = new OrbitControls(camera, nextRenderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.06
      controls.minDistance = 0.3
      controls.maxDistance = 150
      controls.addEventListener("change", markAnnotationsDirty)
      controls.addEventListener("start", requestRender)
      controls.addEventListener("end", requestRender)

      loadingMesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.4, 0.05, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }),
      )
      scene.add(loadingMesh)
      disposableResources.push(loadingMesh.geometry, loadingMesh.material as THREE.Material)

      const loader = new GLTFLoader()

      const loadResolvedModel = async (resolvedModel: ResolvedModel, phase: "initial" | "refresh") => {
        const nextModelVersion = getModelVersion(resolvedModel)

        if (nextModelVersion === currentModelVersion) {
          return
        }

        setErrorMessage(null)
        setStatusMessage(phase === "initial" ? "Loading GLB..." : "Refreshing geometry...")

        const gltf = await loadGltf(loader, resolvedModel.modelUrl)

        if (disposed) return

        if (loadingMesh) {
          scene.remove(loadingMesh)
          loadingMesh = null
        }

        if (modelRoot) {
          clearModelHighlight()
          scene.remove(modelRoot)
          disposeModelResources(modelRoot)
          modelRoot = null
        }
        clearAnnotations()
        componentRootsById.clear()
        setSelectedComponent(null)

        const model = gltf.scene
        modelRoot = model

        applyLightweightPreviewStyle(model)

        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = maxDim > 0 ? 3.5 / maxDim : 1
        model.scale.setScalar(scale)
        model.position.sub(center.multiplyScalar(scale))

        const groundedBox = new THREE.Box3().setFromObject(model)
        model.position.y -= groundedBox.min.y

        scene.add(model)
        addLightweightMeshEdges(model)
        setSceneMode(viewerModeRef.current)

        const sphere = new THREE.Sphere()
        new THREE.Box3().setFromObject(model).getBoundingSphere(sphere)
        const radius = Math.max(sphere.radius, 0.2)
        const sphereCenter = sphere.center

        camera.position.set(
          sphereCenter.x + radius * 2.2,
          sphereCenter.y + radius * 1.4,
          sphereCenter.z + radius * 2.2,
        )
        controls?.target.copy(sphereCenter)
        controls?.update()

        buildAnnotations(model, camera)
        currentModelVersion = nextModelVersion
        setStatusMessage("")
        requestRender()
      }

      const resolveLatestModel = async (phase: "initial" | "refresh") => {
        const resolvedModel = await fetchResolvedModel(modelSource, modelRequest.signal)
        if (!resolvedModel) {
          if (phase === "initial") {
            throw new Error("Unable to resolve a CAD GLB artifact.")
          }
          return
        }

        if (disposed) return

        await loadResolvedModel(resolvedModel, phase)
      }

      const syncViewport = () => {
        const nextWidth = mount.clientWidth
        const nextHeight = mount.clientHeight
        if (nextWidth <= 0 || nextHeight <= 0) return

        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
        nextRenderer.setPixelRatio(
          Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO),
        )
        nextRenderer.setSize(nextWidth, nextHeight)
        refreshAnnotationMeasurements()
        layoutAnnotations(camera, true)
        requestRender()
      }

      const resizeObserver = new ResizeObserver(() => {
        syncViewport()
      })
      resizeObserver.observe(mount)

      document.fonts?.ready.then(() => {
        if (disposed) return
        refreshAnnotationMeasurements()
        layoutAnnotations(camera, true)
        requestRender()
      })

      window.addEventListener("message", handleComponentMessage)

      nextRenderer.setAnimationLoop(() => {
        if (disposed) return

        if (loadingMesh) {
          loadingMesh.rotation.z += 0.04
          renderRequested = true
        }

        if (controls?.update()) {
          renderRequested = true
        }

        if (!renderRequested && !annotationsNeedLayout) return

        updateAxisOverlay(camera)
        layoutAnnotations(camera)
        nextRenderer.render(scene, camera)
        renderRequested = false
      })

      const refreshLatestModel = (phase: "initial" | "refresh") => {
        if (modelRefreshInFlight) return
        modelRefreshInFlight = true
        void resolveLatestModel(phase)
          .catch((error: unknown) => {
            if (disposed) return
            if (phase === "initial") {
              setStatusMessage(modelSource.autoRefresh ? `Waiting for ${getVariantDisplayName(modelSource.variant)}...` : "")
              setErrorMessage(
                modelSource.autoRefresh
                  ? null
                  : error instanceof Error ? error.message : "Unable to resolve a CAD GLB artifact.",
              )
            } else {
              console.error("Viewer3D auto-refresh error:", error)
            }
          })
          .finally(() => {
            modelRefreshInFlight = false
          })
      }

      const handleModeChange = () => {
        setSceneMode(viewerModeRef.current)
        if (viewerModeRef.current === "temperature") {
          void loadTemperatureField(scene, camera)
        }
      }

      window.addEventListener("viewer3d:mode-change", handleModeChange)
      refreshLatestModel("initial")

      if (modelSource.autoRefresh) {
        lookupInterval = setInterval(() => {
          refreshLatestModel("refresh")
        }, 3000)
      }

      return () => {
        resizeObserver.disconnect()
        window.removeEventListener("message", handleComponentMessage)
        window.removeEventListener("viewer3d:mode-change", handleModeChange)
        controls?.removeEventListener("change", markAnnotationsDirty)
        controls?.removeEventListener("start", requestRender)
        controls?.removeEventListener("end", requestRender)
        if (lookupInterval) {
          clearInterval(lookupInterval)
          lookupInterval = null
        }
      }
    }

    let disposeResize: (() => void) | undefined

    init()
      .then((cleanup) => {
        if (disposed) {
          cleanup?.()
          return
        }
        disposeResize = cleanup
      })
      .catch((error: unknown) => {
        if (disposed) return
        console.error("Viewer3D init error:", error)
        setErrorMessage(error instanceof Error ? error.message : "Viewer initialization failed.")
        setStatusMessage("")
      })

    return () => {
      disposed = true
      modelRequest.abort()
      disposeResize?.()
      clearModelHighlight()
      clearAnnotations()
      setTemperatureRange(null)
      controls?.dispose()
      renderer?.setAnimationLoop(null)
      if (lookupInterval) clearInterval(lookupInterval)
      disposeModelResources(modelRoot)
      if (temperatureRoot) {
        disposeModelResources(temperatureRoot)
      }

      disposableResources.forEach((resource) => resource.dispose())
      renderer?.dispose()

      if (mount && domElement && mount.contains(domElement)) {
        mount.removeChild(domElement)
      }
    }
  }, [modelVariant, versionId, workspaceDir, workspaceId])

  useEffect(() => {
    window.dispatchEvent(new Event("viewer3d:mode-change"))
  }, [viewerMode])

  const isDeratingMode = showDeratingMode && viewerMode === "derating"
  const isLightDeratingMode = isDeratingMode && viewerTheme === "light"

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: isLightDeratingMode ? "#f6f8fb" : "#111318",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      {showDeratingMode && viewerMode === "derating" ? (
        <div
          style={{
            bottom: 0,
            left: 0,
            position: "absolute",
            right: 0,
            top: 56,
            zIndex: 4,
            background: isLightDeratingMode ? "#f6f8fb" : "#06111d",
          }}
        >
          <DeratingMissingItemsPanel
            theme={viewerTheme}
            versionId={versionId}
            workspaceDir={workspaceDir}
            workspaceId={workspaceId}
          />
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          left: 18,
          top: 18,
          display: "flex",
          gap: 6,
          padding: 4,
          borderRadius: 8,
          background: isLightDeratingMode ? "rgba(255, 255, 255, 0.84)" : "rgba(6, 12, 27, 0.74)",
          border: isLightDeratingMode ? "1px solid rgba(35, 82, 124, 0.16)" : "1px solid rgba(122, 148, 212, 0.28)",
          boxShadow: isLightDeratingMode ? "0 8px 24px rgba(18, 34, 51, 0.08)" : undefined,
          backdropFilter: "blur(12px)",
          pointerEvents: "auto",
        }}
      >
        {(showDeratingMode
          ? ([["derating", "降额"]] as const)
          : ([
              ["cad", "CAD"],
              ["temperature", "Thermal"],
            ] as const)
        ).map(([mode, label]) => {
          const active = viewerMode === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setViewerMode(mode)}
              style={{
                minWidth: 92,
                height: 32,
                border: isLightDeratingMode ? "1px solid rgba(0, 102, 204, 0.24)" : "1px solid rgba(143, 172, 230, 0.28)",
                borderRadius: 6,
                background: isLightDeratingMode
                  ? active ? "#e8f2ff" : "#ffffff"
                  : active ? "rgba(65, 167, 255, 0.24)" : "rgba(11, 21, 45, 0.68)",
                color: isLightDeratingMode
                  ? active ? "#003f88" : "#344054"
                  : active ? "#f4f9ff" : "rgba(211, 226, 255, 0.78)",
                cursor: "pointer",
                fontFamily: "\"IBM Plex Sans\", system-ui, sans-serif",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {viewerMode === "temperature" && temperatureRange && (
        <div
          style={{
            position: "absolute",
            left: 18,
            bottom: 18,
            display: "grid",
            gap: 8,
            width: 220,
            padding: "12px",
            borderRadius: 8,
            background: "rgba(6, 12, 27, 0.74)",
            border: "1px solid rgba(122, 148, 212, 0.28)",
            backdropFilter: "blur(12px)",
            color: "#d9e6ff",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: "linear-gradient(90deg, #0066ff 0%, #00d4ff 35%, #23d66b 50%, #f4d03f 70%, #ff3b30 100%)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.16) inset",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "\"IBM Plex Mono\", Consolas, monospace",
              fontSize: 11,
              color: "rgba(218, 231, 255, 0.82)",
            }}
          >
            <span>{temperatureRange.min.toFixed(2)} K</span>
            <span>{temperatureRange.max.toFixed(2)} K</span>
          </div>
        </div>
      )}

      <svg
        ref={axisSvgRef}
        aria-label="XYZ positive axis indicator"
        viewBox="0 0 92 92"
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          width: 58,
          height: 58,
          pointerEvents: "none",
        }}
      >
        <defs>
          <marker id="axis-arrow-x" markerWidth="4" markerHeight="4" refX="3.6" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 Z" fill="#ff5f68" />
          </marker>
          <marker id="axis-arrow-y" markerWidth="4" markerHeight="4" refX="3.6" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 Z" fill="#6ee77f" />
          </marker>
          <marker id="axis-arrow-z" markerWidth="4" markerHeight="4" refX="3.6" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 Z" fill="#6ba8ff" />
          </marker>
        </defs>
        <circle cx="28" cy="62" r="3.2" fill="rgba(231, 238, 255, 0.88)" />
        <line data-axis-line="x" x1="28" y1="62" x2="58" y2="62" stroke="#ff5f68" strokeWidth="3" strokeLinecap="round" markerEnd="url(#axis-arrow-x)" />
        <line data-axis-line="y" x1="28" y1="62" x2="8" y2="82" stroke="#6ee77f" strokeWidth="3" strokeLinecap="round" markerEnd="url(#axis-arrow-y)" />
        <line data-axis-line="z" x1="28" y1="62" x2="28" y2="28" stroke="#6ba8ff" strokeWidth="3" strokeLinecap="round" markerEnd="url(#axis-arrow-z)" />
        <text data-axis-label="x" x="66" y="65" fill="#ff8b91" fontFamily="IBM Plex Mono, Consolas, monospace" fontSize="12" fontWeight="700" textAnchor="middle">X</text>
        <text data-axis-label="y" x="1" y="90" fill="#8cf49a" fontFamily="IBM Plex Mono, Consolas, monospace" fontSize="12" fontWeight="700" textAnchor="middle">Y</text>
        <text data-axis-label="z" x="28" y="18" fill="#8fbdff" fontFamily="IBM Plex Mono, Consolas, monospace" fontSize="12" fontWeight="700" textAnchor="middle">Z</text>
      </svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      >
        <svg
          ref={annotationSvgRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        />
        <div
          ref={annotationLabelsRef}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
          }}
        />
      </div>

      {selectedComponent && (
        <div
          style={{
            position: "absolute",
            right: 18,
            bottom: 18,
            width: "min(360px, calc(100vw - 36px))",
            display: "grid",
            gap: 12,
            padding: "16px",
            borderRadius: 8,
            background: "rgba(6, 12, 27, 0.84)",
            border: "1px solid rgba(122, 148, 212, 0.34)",
            boxShadow: "0 18px 42px rgba(0, 0, 0, 0.34)",
            backdropFilter: "blur(12px)",
            color: "#d9e6ff",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "start",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
              <span
                style={{
                  color: "#93b7ff",
                  fontFamily: "\"IBM Plex Mono\", Consolas, monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                {selectedComponent.componentId}
              </span>
              <span
                style={{
                  color: "#f3f7ff",
                  fontFamily: "\"Space Grotesk\", system-ui, sans-serif",
                  fontSize: 18,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  overflowWrap: "anywhere",
                }}
              >
                {selectedComponent.semanticName}
              </span>
            </div>
            <button
              type="button"
              aria-label="Close component details"
              onClick={() => setSelectedComponent(null)}
              style={{
                width: 28,
                height: 28,
                flex: "0 0 auto",
                border: "1px solid rgba(143, 172, 230, 0.32)",
                borderRadius: 6,
                background: "rgba(11, 21, 45, 0.72)",
                color: "rgba(218, 231, 255, 0.86)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: "24px",
              }}
            >
              x
            </button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {[
              ["semantic_name", selectedComponent.semanticName],
              ["kind", selectedComponent.kind],
              ["subsystem", selectedComponent.subsystem],
              ["dimensions", selectedComponent.dimensions],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "96px minmax(0, 1fr)",
                  gap: 10,
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    color: "rgba(145, 172, 226, 0.68)",
                    fontFamily: "\"IBM Plex Mono\", Consolas, monospace",
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    color: "#d9e6ff",
                    fontFamily: "\"IBM Plex Sans\", system-ui, sans-serif",
                    fontSize: 13,
                    lineHeight: 1.45,
                    overflowWrap: "anywhere",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(statusMessage || errorMessage) && (
        <div
          style={{
            position: "absolute",
            top: 72,
            left: 20,
            display: "grid",
            gap: 6,
            maxWidth: 520,
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(6, 12, 27, 0.66)",
            border: "1px solid rgba(92, 126, 188, 0.24)",
            backdropFilter: "blur(10px)",
            color: "#c9dbff",
            pointerEvents: "none",
          }}
        >
          {statusMessage && (
            <span
              style={{
                fontFamily: "\"IBM Plex Mono\", Consolas, monospace",
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "rgba(152, 183, 235, 0.74)",
              }}
            >
              {statusMessage}
            </span>
          )}
          {errorMessage && (
            <span
              style={{
                fontFamily: "\"IBM Plex Sans\", system-ui, sans-serif",
                fontSize: 13,
                lineHeight: 1.45,
                color: "#ffb4b4",
              }}
            >
              {errorMessage}
            </span>
          )}
        </div>
      )}

    </div>
  )
}
