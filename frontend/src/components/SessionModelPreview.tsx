import { useEffect, useRef, useState } from "react"
import * as THREE from "three/webgpu"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import {
  collectComponentRoots,
  resolveComponentLabel,
} from "../pages/viewer3d/annotations"
import { fetchResolvedModel, getModelVersion } from "../pages/viewer3d/modelSource"
import {
  addLightweightMeshEdges,
  applyLightweightPreviewStyle,
  disposeModelResources,
  loadGltf,
} from "../pages/viewer3d/modelUtils"
import type { Disposable, ResolvedModel, WebGPURendererRuntime } from "../pages/viewer3d/types"
import {
  cacheCanvasThumbnail,
  createObjectUrl,
  CURRENT_THUMBNAIL_CACHE_PREFIX,
  readCachedThumbnailBlob,
  SAMPLE_THUMBNAIL_CACHE_PREFIX,
} from "./thumbnailCache"

const MAX_DEVICE_PIXEL_RATIO = 1.15
const THUMBNAIL_RENDER_SCALE = 1.2
const MAX_COMPONENT_LABELS = 4
const SAMPLE_THUMBNAIL_PIXEL_RATIO = 2
const SAMPLE_THUMBNAIL_QUALITY = 0.94

interface SessionModelPreviewProps {
  sessionId: string
}

function getThumbnailCacheKey(sessionId: string, model: ResolvedModel) {
  return `${CURRENT_THUMBNAIL_CACHE_PREFIX}${sessionId}:${getModelVersion(model)}`
}

function getSampleThumbnailCacheKey(sessionId: string, model: ResolvedModel, variant: "featured" | "card") {
  return `${SAMPLE_THUMBNAIL_CACHE_PREFIX}${sessionId}:${variant}:${getModelVersion(model)}`
}

async function writeSampleThumbnailVariant(
  cacheKey: string,
  sourceCanvas: HTMLCanvasElement,
  variant: "featured" | "card",
) {
  const displayTarget = variant === "featured"
    ? { height: 340, width: 560 }
    : { height: 150, width: 360 }
  const target = {
    height: Math.round(displayTarget.height * SAMPLE_THUMBNAIL_PIXEL_RATIO),
    width: Math.round(displayTarget.width * SAMPLE_THUMBNAIL_PIXEL_RATIO),
  }
  const canvas = document.createElement("canvas")
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  const bg = ctx.createLinearGradient(0, 0, target.width, target.height)
  bg.addColorStop(0, "#070b16")
  bg.addColorStop(0.58, "#101a2b")
  bg.addColorStop(1, "#070915")
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, target.width, target.height)
  const glow = ctx.createRadialGradient(
    target.width * 0.58,
    target.height * 0.34,
    0,
    target.width * 0.58,
    target.height * 0.34,
    target.width * 0.56,
  )
  glow.addColorStop(0, "rgba(119, 170, 255, 0.28)")
  glow.addColorStop(1, "rgba(119, 170, 255, 0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, target.width, target.height)

  const scaleRatio = target.width / displayTarget.width
  const innerWidth = displayTarget.width * 0.98 * scaleRatio
  const innerHeight = displayTarget.height * (variant === "featured" ? 0.9 : 0.88) * scaleRatio
  const scale = Math.min(
    innerWidth / sourceCanvas.width,
    innerHeight / sourceCanvas.height,
  )
  const drawWidth = sourceCanvas.width * scale
  const drawHeight = sourceCanvas.height * scale
  const drawX = (target.width - drawWidth) / 2
  const drawY = (target.height - drawHeight) / 2
  ctx.shadowColor = "rgba(80, 120, 190, 0.34)"
  ctx.shadowBlur = 28 * scaleRatio
  ctx.shadowOffsetY = 8 * scaleRatio
  ctx.drawImage(sourceCanvas, drawX, drawY, drawWidth, drawHeight)
  ctx.shadowColor = "transparent"

  return cacheCanvasThumbnail(cacheKey, canvas, SAMPLE_THUMBNAIL_QUALITY)
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const right = x + width
  const bottom = y + height
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(right - radius, y)
  ctx.quadraticCurveTo(right, y, right, y + radius)
  ctx.lineTo(right, bottom - radius)
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom)
  ctx.lineTo(x + radius, bottom)
  ctx.quadraticCurveTo(x, bottom, x, bottom - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function normalizePreviewLabel(name: string) {
  return name
    .replace(/(?:[_\s-]+)?(part|component|group|mesh)$/i, "")
    .trim()
}

function collectFallbackComponents(model: THREE.Object3D) {
  const seen = new Set<string>()
  const components: Array<{ label: string; node: THREE.Object3D }> = []

  model.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return

    const candidates = [
      normalizePreviewLabel(node.parent?.name ?? ""),
      normalizePreviewLabel(node.name),
    ].filter(Boolean)
    const label = candidates.find((candidate) => !seen.has(candidate))
    if (!label) return

    seen.add(label)
    components.push({ label, node })
  })

  return components
}

function collectPreviewLabels(model: THREE.Object3D, camera: THREE.PerspectiveCamera, width: number, height: number) {
  const projected = new THREE.Vector3()
  camera.updateMatrixWorld(true)

  const primaryComponents = collectComponentRoots(model)
    .map((componentRoot) => ({
      label: resolveComponentLabel(componentRoot),
      node: componentRoot,
    }))
    .filter((component) => component.label.length > 0)

  const components = primaryComponents.length > 0
    ? primaryComponents
    : collectFallbackComponents(model)

  return components
    .map((component) => {
      const bounds = new THREE.Box3().setFromObject(component.node)
      if (bounds.isEmpty()) return null

      const center = bounds.getCenter(new THREE.Vector3())
      const anchor = new THREE.Vector3(center.x, bounds.max.y, center.z)
      projected.copy(anchor).project(camera)
      if (
        projected.z < -1 ||
        projected.z > 1 ||
        projected.x < -1.35 ||
        projected.x > 1.35 ||
        projected.y < -1.35 ||
        projected.y > 1.35
      ) {
        return null
      }

      return {
        label: component.label,
        screenX: (projected.x * 0.5 + 0.5) * width,
        screenY: (-projected.y * 0.5 + 0.5) * height,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(0, MAX_COMPONENT_LABELS)
}

function createLabeledThumbnail(
  sourceCanvas: HTMLCanvasElement,
  labels: Array<{ label: string; screenX: number; screenY: number }>,
) {
  const canvas = document.createElement("canvas")
  canvas.width = sourceCanvas.width
  canvas.height = sourceCanvas.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return sourceCanvas

  ctx.drawImage(sourceCanvas, 0, 0)

  const uiScale = Math.max(
    1,
    Math.min(sourceCanvas.width / 280, sourceCanvas.height / 156),
  )
  ctx.font = `700 ${Math.round(11 * uiScale)}px IBM Plex Mono, SFMono-Regular, Consolas, monospace`
  ctx.lineWidth = Math.max(1.5, 1.6 * uiScale)
  labels.forEach((item, index) => {
    const anchorX = item.screenX
    const anchorY = item.screenY
    const side = index % 2 === 0 ? "left" : "right"
    const labelWidth = Math.min(
      Math.max(ctx.measureText(item.label).width + 20 * uiScale, 58 * uiScale),
      126 * uiScale,
    )
    const labelHeight = 24 * uiScale
    const labelX = side === "left"
      ? 10 * uiScale
      : sourceCanvas.width - labelWidth - 10 * uiScale
    const labelY = Math.min(
      Math.max(12 * uiScale + index * 30 * uiScale, 10 * uiScale),
      sourceCanvas.height - labelHeight - 10 * uiScale,
    )
    const labelCenterY = labelY + labelHeight * 0.5
    const labelEdgeX = side === "left" ? labelX + labelWidth : labelX
    const elbowX = side === "left"
      ? Math.max(labelEdgeX + 8 * uiScale, anchorX - 18 * uiScale)
      : Math.min(labelEdgeX - 8 * uiScale, anchorX + 18 * uiScale)

    ctx.strokeStyle = "rgba(139, 164, 255, 0.88)"
    ctx.fillStyle = "rgba(139, 164, 255, 1)"
    ctx.beginPath()
    ctx.moveTo(anchorX, anchorY)
    ctx.lineTo(anchorX, labelCenterY)
    ctx.lineTo(elbowX, labelCenterY)
    ctx.lineTo(labelEdgeX, labelCenterY)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(anchorX, anchorY, 3.2 * uiScale, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.88)"
    ctx.stroke()

    drawRoundRect(ctx, labelX, labelY, labelWidth, labelHeight, 4 * uiScale)
    ctx.fillStyle = "rgba(5, 10, 24, 0.92)"
    ctx.fill()
    ctx.strokeStyle = "rgba(160, 181, 255, 0.72)"
    ctx.stroke()

    ctx.fillStyle = "#e3e9ff"
    const text = item.label.length > 14 ? `${item.label.slice(0, 13)}...` : item.label
    ctx.fillText(text.toUpperCase(), labelX + 10 * uiScale, labelY + 16 * uiScale)
  })

  return canvas
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

export function SessionModelPreview({ sessionId }: SessionModelPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [shouldLoad, setShouldLoad] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty">("idle")

  const setThumbnailBlob = (blob: Blob) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = createObjectUrl(blob)
    objectUrlRef.current = url
    setThumbnailUrl(url)
  }

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  useEffect(() => {
    if (import.meta.env.MODE === "test") return

    const root = rootRef.current
    if (!root || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => setShouldLoad(entry.isIntersecting),
      { rootMargin: "260px 0px", threshold: 0.01 },
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!shouldLoad) return

    const mount = mountRef.current
    if (!mount) {
      setStatus("empty")
      return
    }

    let disposed = false
    let renderer: WebGPURendererRuntime | null = null
    let domElement: HTMLCanvasElement | null = null
    let modelRoot: THREE.Object3D | null = null
    const controller = new AbortController()
    const disposableResources: Disposable[] = []

    const cleanupPreviewResources = () => {
      disposeModelResources(modelRoot)
      modelRoot = null
      disposableResources.splice(0).forEach((resource) => resource.dispose())
      renderer?.dispose()
      renderer = null
      if (mount && domElement && mount.contains(domElement)) {
        mount.removeChild(domElement)
      }
      domElement = null
    }

    const renderThumbnail = async (resolvedModel: ResolvedModel, cacheKey: string) => {
      const width = Math.round((mount.clientWidth || 280) * THUMBNAIL_RENDER_SCALE)
      const height = Math.round((mount.clientHeight || 156) * THUMBNAIL_RENDER_SCALE)
      const displayWidth = mount.clientWidth || 280
      const displayHeight = mount.clientHeight || 156
      const nextRenderer = new THREE.WebGPURenderer({
        alpha: false,
        antialias: true,
      }) as unknown as WebGPURendererRuntime
      renderer = nextRenderer
      await nextRenderer.init()

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
      domElement.style.display = "block"
      domElement.style.height = `${displayHeight}px`
      domElement.style.width = `${displayWidth}px`
      mount.appendChild(domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x111318)

      const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 1000)

      const loader = new GLTFLoader()
      const gltf = await loadGltf(loader, resolvedModel.modelUrl)
      if (disposed) return

      const model = gltf.scene
      modelRoot = model
      applyLightweightPreviewStyle(model, 0.2)

      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const scale = maxDim > 0 ? 2.35 / maxDim : 1
      model.scale.setScalar(scale)
      model.position.sub(center.multiplyScalar(scale))

      const groundedBox = new THREE.Box3().setFromObject(model)
      model.position.y -= groundedBox.min.y
      scene.add(model)
      addLightweightMeshEdges(model)

      const sphere = new THREE.Sphere()
      new THREE.Box3().setFromObject(model).getBoundingSphere(sphere)
      const radius = Math.max(sphere.radius, 0.35)
      const target = sphere.center
      const aspectBias = Math.max(0, (size.x - size.y) / Math.max(size.x, size.y, size.z, 1))
      camera.position.set(
        target.x + radius * (2.2 + aspectBias * 0.35),
        target.y + radius * 1.25,
        target.z + radius * 2.35,
      )
      camera.lookAt(target)

      nextRenderer.render(scene, camera)
      await nextFrame()

      if (disposed || !domElement) return
      const bufferWidth = domElement.width || width
      const bufferHeight = domElement.height || height
      const labels = collectPreviewLabels(model, camera, bufferWidth, bufferHeight)
      const labeledCanvas = createLabeledThumbnail(domElement, labels)
      const blob = await cacheCanvasThumbnail(cacheKey, labeledCanvas, 0.9)
      await Promise.all([
        writeSampleThumbnailVariant(getSampleThumbnailCacheKey(sessionId, resolvedModel, "featured"), labeledCanvas, "featured"),
        writeSampleThumbnailVariant(getSampleThumbnailCacheKey(sessionId, resolvedModel, "card"), labeledCanvas, "card"),
      ])
      if (disposed) return
      if (blob) {
        setThumbnailBlob(blob)
        setStatus("ready")
      } else {
        setStatus("empty")
      }

      cleanupPreviewResources()
    }

    const init = async () => {
      setStatus("loading")
      const resolvedModel = await fetchResolvedModel(
        {
          autoRefresh: false,
          lookupUrl: `/api/freecad/model?${new URLSearchParams({ sessionId }).toString()}`,
          variant: "original",
        },
        controller.signal,
      )

      if (!resolvedModel || disposed) {
        setStatus("empty")
        return
      }

      const cacheKey = getThumbnailCacheKey(sessionId, resolvedModel)
      const cachedThumbnail = await readCachedThumbnailBlob(cacheKey)
      if (disposed) return
      if (cachedThumbnail) {
        setThumbnailBlob(cachedThumbnail)
        setStatus("ready")
        return
      }

      await renderThumbnail(resolvedModel, cacheKey)
    }

    init().catch(() => {
      if (!disposed) setStatus("empty")
      cleanupPreviewResources()
    })

    return () => {
      disposed = true
      controller.abort()
      cleanupPreviewResources()
    }
  }, [sessionId, shouldLoad])

  return (
    <div
      ref={rootRef}
      className="relative h-full min-h-[156px] w-full overflow-hidden border-b border-black/[0.06] bg-transparent"
    >
      {thumbnailUrl ? (
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          src={thumbnailUrl}
        />
      ) : (
        <div ref={mountRef} className="h-full w-full" />
      )}

      {!thumbnailUrl && status !== "ready" && (
        <div className="pointer-events-none absolute left-3 top-3 border border-white/15 bg-black/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/72 backdrop-blur-sm">
          {status === "loading" ? "生成" : status === "empty" ? "无模型" : "预览"}
        </div>
      )}

      {!thumbnailUrl && status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center text-[12px] text-[#9da8bc]">
          {status === "idle"
            ? "准备预览图片..."
            : status === "loading"
              ? "生成预览图片..."
              : "暂无预览图片"}
        </div>
      )}
    </div>
  )
}
