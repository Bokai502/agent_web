import * as THREE from "three/webgpu"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

const LIGHTWEIGHT_SURFACE_COLOR = 0x8da2ad
const LIGHTWEIGHT_EDGE_COLOR = 0x9ec4d3
const COMPONENT_PREVIEW_COLORS = [
  0xc47635,
  0x90a8ff,
  0x70c4ff,
  0xb38cff,
  0xffcf70,
  0x71f0a0,
]
const LEGACY_COMPONENT_COLORS: Record<string, number> = {
  P001: 0xb7430c,
  P002: 0xb7430c,
  P003: 0x20ff4e,
  P004: 0x20ff4e,
  P005: 0xb7430c,
  P006: 0xb7430c,
  P007: 0xb7430c,
  P008: 0xb7430c,
  P009: 0xff9320,
  P010: 0xff9320,
  P011: 0x204eff,
  P012: 0x204eff,
  P013: 0x7439b7,
  P014: 0x7439b7,
  P015: 0x7439b7,
  P016: 0x7439b7,
  P017: 0x7439b7,
  P018: 0x747474,
  P019: 0x747474,
  P020: 0x204eff,
  P021: 0x204eff,
  P022: 0x204eff,
  P023: 0x204eff,
  P024: 0x204eff,
  P025: 0x204eff,
  P026: 0x204eff,
  P027: 0x204eff,
  P028: 0x204eff,
  P029: 0x204eff,
  P030: 0x939393,
  P031: 0x939393,
  P032: 0x939393,
  P033: 0x939393,
  P034: 0x939393,
  P035: 0x939393,
  P036: 0xb7430c,
  P037: 0xb7430c,
  P038: 0xb7430c,
  P039: 0xb7430c,
  P040: 0xb7430c,
  P041: 0xb7430c,
  P042: 0xb7430c,
  P043: 0xb7430c,
  P044: 0xb7430c,
  P045: 0xb7430c,
  P046: 0xb7430c,
  P047: 0xb7430c,
  P048: 0xb7430c,
  P049: 0xb7430c,
}

export function applyTransparency(material: THREE.Material, opacity = 0.42) {
  material.transparent = true
  material.opacity = opacity
  material.depthWrite = false
  material.side = THREE.DoubleSide

  if (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  ) {
    material.roughness = Math.max(material.roughness, 0.72)
    material.metalness = Math.min(material.metalness, 0.02)
    material.envMapIntensity = 0.22
  }

  material.needsUpdate = true
}

function disposeMaterialResources(material: THREE.Material) {
  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) {
      value.dispose()
    }
  })
  material.dispose()
}

function getMaterialColor(material: THREE.Material | null | undefined) {
  const candidate = material as THREE.Material & { color?: THREE.Color }
  return candidate?.color instanceof THREE.Color
    ? candidate.color.clone()
    : new THREE.Color(LIGHTWEIGHT_SURFACE_COLOR)
}

function createLightweightMaterial(material: THREE.Material, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color: getMaterialColor(material),
    depthWrite: false,
    opacity,
    side: THREE.DoubleSide,
    transparent: true,
    vertexColors: material.vertexColors,
  })
}

function componentColorFromName(name: string) {
  const match = name.match(/^P(\d{3})$/iu)
  if (!match) return null
  const normalizedName = `P${match[1]}`
  const legacyColor = LEGACY_COMPONENT_COLORS[normalizedName]
  if (legacyColor !== undefined) return new THREE.Color(legacyColor)
  const index = Math.max(0, Number(match[1]) - 1)
  return new THREE.Color(COMPONENT_PREVIEW_COLORS[index % COMPONENT_PREVIEW_COLORS.length])
}

function resolveComponentColor(mesh: THREE.Mesh) {
  let current: THREE.Object3D | null = mesh
  while (current) {
    const color = componentColorFromName(current.name)
    if (color) return color
    current = current.parent
  }
  return null
}

function getMeshEdgeColor(mesh: THREE.Mesh) {
  const componentColor = resolveComponentColor(mesh)
  if (componentColor) return componentColor.clone().lerp(new THREE.Color(0xffffff), 0.28)

  const material = Array.isArray(mesh.material)
    ? mesh.material[0]
    : mesh.material
  return getMaterialColor(material).lerp(new THREE.Color(0xffffff), 0.28)
}

export function applyLightweightPreviewStyle(root: THREE.Object3D, opacity = 0.18) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return

    const componentColor = resolveComponentColor(mesh)
    const originalMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    const lightweightMaterials = originalMaterials.map((material) => {
      const lightweightMaterial = createLightweightMaterial(material, opacity)
      if (componentColor) lightweightMaterial.color.copy(componentColor)
      return lightweightMaterial
    })
    mesh.material = Array.isArray(mesh.material)
      ? lightweightMaterials
      : lightweightMaterials[0]
    originalMaterials.forEach(disposeMaterialResources)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 1
  })
}

export function addLightweightMeshEdges(root: THREE.Object3D) {
  const edges: THREE.LineSegments[] = []

  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return

    const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 12)
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: getMeshEdgeColor(mesh) ?? LIGHTWEIGHT_EDGE_COLOR,
      depthTest: true,
      depthWrite: false,
      opacity: 0.72,
      transparent: true,
    })
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial)
    edgeLines.name = `${mesh.name || "mesh"}_lightweight_edges`
    edgeLines.renderOrder = 3
    mesh.add(edgeLines)
    edges.push(edgeLines)
  })

  return edges
}

export function disposeModelResources(root: THREE.Object3D | null) {
  if (!root) return

  const disposedGeometries = new Set<THREE.BufferGeometry>()
  const disposedMaterials = new Set<THREE.Material>()
  const disposedTextures = new Set<THREE.Texture>()

  root.traverse((node) => {
    const line = node as THREE.Line
    const mesh = node as THREE.Mesh

    if (!mesh.isMesh && !line.isLine) return

    const geometry = mesh.geometry ?? line.geometry
    if (geometry && !disposedGeometries.has(geometry)) {
      disposedGeometries.add(geometry)
      geometry.dispose()
    }

    const nodeMaterial = mesh.material ?? line.material
    const materials = Array.isArray(nodeMaterial)
      ? nodeMaterial
      : [nodeMaterial]

    materials.forEach((material) => {
      if (disposedMaterials.has(material)) return

      Object.values(material ?? {}).forEach((value) => {
        if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
          disposedTextures.add(value)
          value.dispose()
        }
      })

      disposedMaterials.add(material)
      material?.dispose()
    })
  })
}

export function loadGltf(loader: GLTFLoader, url: string) {
  return new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    loader.load(url, resolve, undefined, reject)
  })
}
