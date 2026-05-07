import { useEffect, useRef, useState } from "react"
import * as THREE from "three/webgpu"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import {
  collectComponentRoots,
  resolveComponentLabel,
} from "../pages/viewer3d/annotations"
import { fetchResolvedModel, getModelVersion } from "../pages/viewer3d/modelSource"
import { applyTransparency, disposeModelResources, loadGltf } from "../pages/viewer3d/modelUtils"
import type { Disposable, ResolvedModel, WebGPURendererRuntime } from "../pages/viewer3d/types"

const MAX_DEVICE_PIXEL_RATIO = 1.5
const MAX_COMPONENT_LABELS = 4
const CACHE_PREFIX = "codex:model-preview-image:v3:"
const SAMPLE_CACHE_PREFIX = "codex:model-preview-image:v6:sample:"
const SAMPLE_THUMBNAIL_PIXEL_RATIO = 1.5
const SAMPLE_THUMBNAIL_QUALITY = 0.92

interface SessionModelPreviewProps {
  sessionId: string
}

function getThumbnailCacheKey(sessionId: string, model: ResolvedModel) {
  return `${CACHE_PREFIX}${sessionId}:${getModelVersion(model)}`
}

function getSampleThumbnailCacheKey(sessionId: string, model: ResolvedModel, variant: "featured" | "card") {
  return `${SAMPLE_CACHE_PREFIX}${sessionId}:${variant}:${getModelVersion(model)}`
}

function readCachedThumbnail(cacheKey: string) {
  try {
    return localStorage.getItem(cacheKey)
  } catch {
    return null
  }
}

function writeCachedThumbnail(cacheKey: string, canvas: HTMLCanvasElement) {
  try {
    const dataUrl = canvas.toDataURL("image/png", 0.86)
    localStorage.setItem(cacheKey, dataUrl)
    return dataUrl
  } catch {
    return null
  }
}

function writeSampleThumbnailVariant(
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

  ctx.fillStyle = "#050914"
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
  ctx.drawImage(sourceCanvas, drawX, drawY, drawWidth, drawHeight)

  try {
    const dataUrl = canvas.toDataURL("image/png", SAMPLE_THUMBNAIL_QUALITY)
    localStorage.setItem(cacheKey, dataUrl)
    return dataUrl
  } catch {
    return null
  }
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

  const scaleX = sourceCanvas.width / (sourceCanvas.clientWidth || sourceCanvas.width)
  const scaleY = sourceCanvas.height / (sourceCanvas.clientHeight || sourceCanvas.height)
  ctx.drawImage(sourceCanvas, 0, 0)

  ctx.font = `700 ${Math.round(11 * scaleY)}px IBM Plex Mono, SFMono-Regular, Consolas, monospace`
  ctx.lineWidth = Math.max(1.5, 1.6 * scaleX)
  labels.forEach((item, index) => {
    const anchorX = item.screenX * scaleX
    const anchorY = item.screenY * scaleY
    const side = index % 2 === 0 ? "left" : "right"
    const labelWidth = Math.min(
      Math.max(ctx.measureText(item.label).width + 20 * scaleX, 58 * scaleX),
      126 * scaleX,
    )
    const labelHeight = 24 * scaleY
    const labelX = side === "left"
      ? 10 * scaleX
      : sourceCanvas.width - labelWidth - 10 * scaleX
    const labelY = Math.min(
      Math.max(12 * scaleY + index * 30 * scaleY, 10 * scaleY),
      sourceCanvas.height - labelHeight - 10 * scaleY,
    )
    const labelCenterY = labelY + labelHeight * 0.5
    const labelEdgeX = side === "left" ? labelX + labelWidth : labelX
    const elbowX = side === "left"
      ? Math.max(labelEdgeX + 8 * scaleX, anchorX - 18 * scaleX)
      : Math.min(labelEdgeX - 8 * scaleX, anchorX + 18 * scaleX)

    ctx.strokeStyle = "rgba(139, 164, 255, 0.88)"
    ctx.fillStyle = "rgba(139, 164, 255, 1)"
    ctx.beginPath()
    ctx.moveTo(anchorX, anchorY)
    ctx.lineTo(anchorX, labelCenterY)
    ctx.lineTo(elbowX, labelCenterY)
    ctx.lineTo(labelEdgeX, labelCenterY)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(anchorX, anchorY, 3.2 * scaleX, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.88)"
    ctx.stroke()

    drawRoundRect(ctx, labelX, labelY, labelWidth, labelHeight, 4 * scaleX)
    ctx.fillStyle = "rgba(5, 10, 24, 0.92)"
    ctx.fill()
    ctx.strokeStyle = "rgba(160, 181, 255, 0.72)"
    ctx.stroke()

    ctx.fillStyle = "#e3e9ff"
    const text = item.label.length > 14 ? `${item.label.slice(0, 13)}...` : item.label
    ctx.fillText(text.toUpperCase(), labelX + 10 * scaleX, labelY + 16 * scaleY)
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
  const [shouldLoad, setShouldLoad] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty">("idle")

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
      const width = mount.clientWidth || 280
      const height = mount.clientHeight || 156
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
      nextRenderer.shadowMap.enabled = true
      nextRenderer.shadowMap.type = THREE.PCFSoftShadowMap
      nextRenderer.outputColorSpace = THREE.SRGBColorSpace
      nextRenderer.toneMapping = THREE.ACESFilmicToneMapping
      nextRenderer.toneMappingExposure = 0.95

      domElement = nextRenderer.domElement
      domElement.style.display = "block"
      domElement.style.height = "100%"
      domElement.style.width = "100%"
      mount.appendChild(domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x050914)
      scene.fog = new THREE.FogExp2(0x050914, 0.028)

      const pmrem = new THREE.PMREMGenerator(nextRenderer as unknown as THREE.WebGLRenderer)
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      scene.environment = envTex
      disposableResources.push(pmrem, envTex)

      const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 1000)
      const keyLight = new THREE.DirectionalLight(0x9fc3ff, 0.95)
      keyLight.position.set(6, 10, 8)
      keyLight.castShadow = true
      scene.add(keyLight)

      const fillLight = new THREE.DirectionalLight(0x3d75c5, 0.35)
      fillLight.position.set(-7, 4, -6)
      scene.add(fillLight)

      const rimLight = new THREE.DirectionalLight(0x8aa7ff, 0.34)
      rimLight.position.set(0, 3, -8)
      scene.add(rimLight)
      scene.add(new THREE.AmbientLight(0x7890b8, 0.18))

      const loader = new GLTFLoader()
      const gltf = await loadGltf(loader, resolvedModel.modelUrl)
      if (disposed) return

      const model = gltf.scene
      modelRoot = model
      model.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = true
        mesh.receiveShadow = true

        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => applyTransparency(material, 0.68))
        } else {
          applyTransparency(mesh.material, 0.68)
        }

        mesh.renderOrder = 1
      })

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
      const labels = collectPreviewLabels(model, camera, width, height)
      const labeledCanvas = createLabeledThumbnail(domElement, labels)
      const dataUrl = writeCachedThumbnail(cacheKey, labeledCanvas)
      writeSampleThumbnailVariant(getSampleThumbnailCacheKey(sessionId, resolvedModel, "featured"), labeledCanvas, "featured")
      writeSampleThumbnailVariant(getSampleThumbnailCacheKey(sessionId, resolvedModel, "card"), labeledCanvas, "card")
      if (dataUrl) {
        setThumbnailUrl(dataUrl)
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
      const cachedThumbnail = readCachedThumbnail(cacheKey)
      if (cachedThumbnail) {
        setThumbnailUrl(cachedThumbnail)
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
