import * as THREE from "three/webgpu"
import type { AnnotationPalette } from "./types"

export const ANNOTATION_PALETTES: AnnotationPalette[] = [
  {
    dot: "#7c8dff",
    line: "rgba(124, 141, 255, 0.56)",
    text: "#b7c2ff",
    tint: "rgba(17, 24, 48, 0.76)",
  },
  {
    dot: "#71b7ff",
    line: "rgba(113, 183, 255, 0.5)",
    text: "#abd9ff",
    tint: "rgba(13, 27, 43, 0.74)",
  },
  {
    dot: "#8ea1c7",
    line: "rgba(142, 161, 199, 0.46)",
    text: "#c3d0eb",
    tint: "rgba(16, 22, 38, 0.72)",
  },
]

export const DEFAULT_ANNOTATION_HEIGHT = 28
export const DEFAULT_ANNOTATION_WIDTH = 84

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isMeshObject(node: THREE.Object3D) {
  return (node as THREE.Mesh).isMesh === true
}

function hasRenderableDescendant(node: THREE.Object3D) {
  let renderable = false

  node.traverse((child) => {
    if (renderable) return
    if (isMeshObject(child)) {
      renderable = true
    }
  })

  return renderable
}

function findComponentContainerRoot(root: THREE.Object3D) {
  let current = root

  while (
    current.children.length === 1 &&
    !isMeshObject(current.children[0]) &&
    !isMeshObject(current)
  ) {
    current = current.children[0]
  }

  return current
}

function normalizeComponentLabel(name: string) {
  return name
    .replace(/(?:[_\s-]+)?(part|component|group)$/i, "")
    .trim()
}

export function resolveComponentLabel(componentRoot: THREE.Object3D) {
  const rootLabel = normalizeComponentLabel(componentRoot.name)
  if (rootLabel) return rootLabel

  if (componentRoot.children.length === 1) {
    const childLabel = normalizeComponentLabel(componentRoot.children[0].name)
    if (childLabel) return childLabel
  }

  const namedDescendant = componentRoot.children.find((child) =>
    hasRenderableDescendant(child) && child.name.trim().length > 0,
  )
  if (namedDescendant) return normalizeComponentLabel(namedDescendant.name)

  return ""
}

export function collectComponentRoots(root: THREE.Object3D) {
  const containerRoot = findComponentContainerRoot(root)
  const componentRoots = containerRoot.children.filter((child) =>
    hasRenderableDescendant(child),
  )

  if (componentRoots.length > 0) return componentRoots
  return hasRenderableDescendant(containerRoot) ? [containerRoot] : []
}

export function distributeLabelTops(
  items: Array<{ desiredTop: number; height: number }>,
  safeTop: number,
  safeBottom: number,
  gap: number,
) {
  if (items.length === 0) return []

  const tops: number[] = []
  let cursor = safeTop

  for (const item of items) {
    const maxTop = safeBottom - item.height
    const desiredTop = clamp(item.desiredTop, safeTop, maxTop)
    const nextTop = Math.max(desiredTop, cursor)
    tops.push(nextTop)
    cursor = nextTop + item.height + gap
  }

  const lastIndex = tops.length - 1
  const overflow = tops[lastIndex] + items[lastIndex].height - safeBottom

  if (overflow > 0) {
    tops[lastIndex] -= overflow

    for (let index = tops.length - 2; index >= 0; index -= 1) {
      const maxTop = tops[index + 1] - items[index].height - gap
      tops[index] = Math.min(tops[index], maxTop)
    }

    if (tops[0] < safeTop) {
      const shift = safeTop - tops[0]
      for (let index = 0; index < tops.length; index += 1) {
        tops[index] += shift
      }
    }
  }

  return tops.map((top, index) =>
    clamp(top, safeTop, safeBottom - items[index].height),
  )
}

export function createAnnotationLabel(id: string, palette: AnnotationPalette) {
  const labelEl = document.createElement("div")
  labelEl.style.position = "absolute"
  labelEl.style.display = "flex"
  labelEl.style.alignItems = "center"
  labelEl.style.gap = "6px"
  labelEl.style.padding = "4px 8px"
  labelEl.style.border = "1px solid rgba(122, 148, 212, 0.42)"
  labelEl.style.borderLeft = `3px solid ${palette.dot}`
  labelEl.style.borderRadius = "6px"
  labelEl.style.background = palette.tint
  labelEl.style.boxShadow = "0 10px 22px rgba(3, 8, 20, 0.28)"
  labelEl.style.backdropFilter = "blur(8px)"
  labelEl.style.cursor = "pointer"
  labelEl.style.pointerEvents = "auto"
  labelEl.style.userSelect = "none"
  labelEl.style.whiteSpace = "nowrap"
  labelEl.style.transform = "translate(-9999px, -9999px)"
  labelEl.style.opacity = "0"
  labelEl.tabIndex = 0
  labelEl.setAttribute("role", "button")
  labelEl.setAttribute("aria-label", `Show details for ${id}`)

  const capEl = document.createElement("span")
  capEl.style.width = "7px"
  capEl.style.height = "7px"
  capEl.style.borderRadius = "999px"
  capEl.style.background = palette.dot
  capEl.style.boxShadow = `0 0 0 5px ${palette.line.replace("0.72", "0.14").replace("0.7", "0.14").replace("0.64", "0.14")}`
  labelEl.appendChild(capEl)

  const textEl = document.createElement("span")
  textEl.textContent = id
  textEl.style.color = palette.text
  textEl.style.fontFamily = "\"Space Grotesk\", \"Noto Sans SC\", system-ui, sans-serif"
  textEl.style.fontSize = "11px"
  textEl.style.fontWeight = "700"
  textEl.style.letterSpacing = "0"
  textEl.style.maxWidth = "180px"
  textEl.style.overflow = "hidden"
  textEl.style.textOverflow = "ellipsis"
  labelEl.appendChild(textEl)

  return labelEl
}

export function measureAnnotationLabel(labelEl: HTMLDivElement) {
  return {
    height: labelEl.offsetHeight || DEFAULT_ANNOTATION_HEIGHT,
    width: labelEl.offsetWidth || DEFAULT_ANNOTATION_WIDTH,
  }
}
