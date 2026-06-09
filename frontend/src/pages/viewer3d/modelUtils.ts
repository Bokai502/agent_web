import * as THREE from "three/webgpu"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

const LIGHTWEIGHT_SURFACE_COLOR = 0x8da2ad
const LIGHTWEIGHT_EDGE_COLOR = 0x9ec4d3

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

function getComponentSourceMesh(mesh: THREE.Mesh) {
  let current: THREE.Object3D | null = mesh
  while (current) {
    if (getComponentIdFromObject(current)) return current
    current = current.parent
  }
  return mesh
}

function getMeshEdgeColor(mesh: THREE.Mesh) {
  const sourceMesh = getComponentSourceMesh(mesh) as THREE.Mesh
  const material = Array.isArray(sourceMesh.material)
    ? sourceMesh.material[0]
    : sourceMesh.material
  const fallbackMaterial = Array.isArray(mesh.material)
    ? mesh.material[0]
    : mesh.material
  return getMaterialColor(material ?? fallbackMaterial).lerp(new THREE.Color(0xffffff), 0.28)
}

export function applyLightweightPreviewStyle(root: THREE.Object3D, opacity = 0.18) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return

    const originalMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    const lightweightMaterials = originalMaterials.map((material) =>
      createLightweightMaterial(material, opacity),
    )
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
