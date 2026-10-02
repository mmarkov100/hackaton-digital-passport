import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as WebIFC from 'web-ifc'

const params = new URLSearchParams(location.search)
const projectId = params.get('project')
const fileId = params.get('file')
let expressId = Number(params.get('expressId'))
const globalId = params.get('globalId')
const name = params.get('name') || 'Элемент IFC'
const status = document.querySelector('#status')
const container = document.querySelector('#scene')
document.querySelector('#element-name').textContent = name
document.querySelector('#element-meta').textContent = `IFC ExpressID: ${expressId || '—'}`

const scene = new THREE.Scene()
scene.background = new THREE.Color('#eaf0f6')
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1e8)
camera.up.set(0, 0, 1)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
container.appendChild(renderer.domElement)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.screenSpacePanning = true
scene.add(new THREE.HemisphereLight(0xffffff, 0x8aa1b8, 2.4))
const sun = new THREE.DirectionalLight(0xffffff, 2)
sun.position.set(2, -3, 5)
scene.add(sun)
let object = null
let bounds = null

function resize() {
  const width = container.clientWidth || 1
  const height = container.clientHeight || 1
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
}
new ResizeObserver(resize).observe(container)
resize()
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })

function fit() {
  if (!bounds) return
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const radius = Math.max(size.length() * 0.5, 0.1)
  controls.target.copy(center)
  const distance = radius / Math.sin(camera.fov * Math.PI / 360) * 0.95
  camera.position.copy(center).add(new THREE.Vector3(distance * 0.75, -distance, distance * 0.7))
  camera.near = Math.max(distance / 10000, 0.001)
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  controls.update()
}
document.querySelector('#fit').onclick = fit
document.querySelector('#wire').onclick = () => {
  if (!object) return
  const next = !object.children[0]?.material.wireframe
  object.children.forEach(mesh => { mesh.material.wireframe = next })
}

async function load() {
  if (!projectId || !fileId || (!expressId && !globalId)) throw Error('Не задана версия IFC или ID элемента')
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ifc/${encodeURIComponent(fileId)}`, { credentials: 'same-origin' })
  if (!response.ok) throw Error(response.status === 403 ? 'Нет доступа к IFC-модели' : `Не удалось загрузить IFC: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  status.textContent = 'Построение геометрии элемента…'
  // Yield once so the loading status is painted before WebAssembly starts parsing.
  await new Promise(resolve => requestAnimationFrame(resolve))
  const api = new WebIFC.IfcAPI()
  api.SetWasmPath('/', true)
  await api.Init()
  const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true })
  if (model < 0) throw Error('IFC-модель не открылась')
  try {
    if (!expressId && globalId) {
      const types = [WebIFC.IFCCOLUMN, WebIFC.IFCBEAM, WebIFC.IFCSLAB, WebIFC.IFCWALL, WebIFC.IFCFOOTING]
      for (const type of types) {
        const ids = api.GetLineIDsWithType(model, type)
        for (let i = 0; i < ids.size(); i++) {
          const candidateId = ids.get(i)
          if (api.GetLine(model, candidateId)?.GlobalId?.value === globalId) { expressId = candidateId; break }
        }
        if (expressId) break
      }
      if (!expressId) throw Error('Элемент с указанным GlobalId не найден в версии IFC')
      document.querySelector('#element-meta').textContent = `IFC ExpressID: ${expressId} · GlobalId: ${globalId}`
    }
    const flat = api.GetFlatMesh(model, expressId)
    if (!flat || !flat.geometries.size()) throw Error('У этого элемента нет доступной 3D-геометрии')
    object = new THREE.Group()
    for (let i = 0; i < flat.geometries.size(); i++) {
      const placed = flat.geometries.get(i)
      const geometry = api.GetGeometry(model, placed.geometryExpressID)
      const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize())
      const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize())
      const positions = new Float32Array(vertices.length / 2)
      const normals = new Float32Array(vertices.length / 2)
      for (let j = 0; j < vertices.length; j += 6) {
        const k = j / 2
        positions[k] = vertices[j]; positions[k + 1] = vertices[j + 1]; positions[k + 2] = vertices[j + 2]
        normals[k] = vertices[j + 3]; normals[k + 1] = vertices[j + 4]; normals[k + 2] = vertices[j + 5]
      }
      const shape = new THREE.BufferGeometry()
      shape.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      shape.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      shape.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1))
      const color = placed.color
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color.x, color.y, color.z),
        side: THREE.DoubleSide,
        transparent: color.w < 0.99,
        opacity: color.w,
        metalness: 0.02,
        roughness: 0.82,
      })
      const mesh = new THREE.Mesh(shape, material)
      mesh.applyMatrix4(new THREE.Matrix4().fromArray(placed.flatTransformation))
      object.add(mesh)
      geometry.delete()
    }
    scene.add(object)
    bounds = new THREE.Box3().setFromObject(object)
    if (bounds.isEmpty()) throw Error('Геометрия элемента пуста')
    fit()
    status.textContent = `Элемент IFC · ${object.children.length} ${object.children.length === 1 ? 'фрагмент' : 'фрагментов'} · вращение мышью, масштаб колесом`
    parent.postMessage({ kind: 'ifc-viewer-ready', expressId }, location.origin)
  } finally { api.CloseModel(model) }
}

load().catch(error => {
  status.textContent = error.message
  status.style.background = '#a42d2ae8'
  parent.postMessage({ kind: 'ifc-viewer-error', message: error.message }, location.origin)
})
