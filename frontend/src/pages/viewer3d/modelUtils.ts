import * as THREE from "three/webgpu"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

const LIGHTWEIGHT_SURFACE_COLOR = 0x8da2ad
const LIGHTWEIGHT_EDGE_COLOR = 0x9ec4d3

export type ComponentColorMap = Record<string, THREE.Color>

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

function normalizeComponentId(value: unknown) {
  if (typeof value !== "string") return null
  const match = value.trim().match(/(?:^|[^a-z0-9])P(\d{3})(?=$|[^a-z0-9])/iu)
  if (!match) return null
  return `P${match[1]}`
}

function getComponentIdFromObject(node: THREE.Object3D) {
  return normalizeComponentId(node.userData?.component_id) ??
    normalizeComponentId(node.userData?.componentId) ??
    normalizeComponentId(node.name)
}

function componentColorFromId(componentId: string | null, componentColors?: ComponentColorMap) {
  if (!componentId || !componentColors) return null
  return componentColors[componentId.toUpperCase()]?.clone() ?? null
}

function resolveComponentColor(mesh: THREE.Mesh, componentColors?: ComponentColorMap) {
  let current: THREE.Object3D | null = mesh
  while (current) {
    const color = componentColorFromId(getComponentIdFromObject(current), componentColors)
    if (color) return color
    current = current.parent
  }
  return null
}

function getMeshEdgeColor(mesh: THREE.Mesh, componentColors?: ComponentColorMap) {
  const componentColor = resolveComponentColor(mesh, componentColors)
  if (componentColor) return componentColor.clone().lerp(new THREE.Color(0xffffff), 0.28)

  const material = Array.isArray(mesh.material)
    ? mesh.material[0]
    : mesh.material
  return getMaterialColor(material).lerp(new THREE.Color(0xffffff), 0.28)
}

export function applyLightweightPreviewStyle(root: THREE.Object3D, opacity = 0.18, componentColors?: ComponentColorMap) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return

    const originalMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    const componentColor = resolveComponentColor(mesh, componentColors)
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

export function addLightweightMeshEdges(root: THREE.Object3D, componentColors?: ComponentColorMap) {
  const edges: THREE.LineSegments[] = []

  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return

    const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 12)
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: getMeshEdgeColor(mesh, componentColors) ?? LIGHTWEIGHT_EDGE_COLOR,
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
