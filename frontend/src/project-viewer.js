import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as WebIFC from 'web-ifc'

const params = new URLSearchParams(location.search)
const project = params.get('project')
const file = params.get('file')
const status = document.querySelector('#status')
const scene = new THREE.Scene()
scene.background = new THREE.Color('#eaf0f6')
const camera = new THREE.PerspectiveCamera(50, 1, .01, 1e8)
camera.up.set(0, 0, 1)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
document.querySelector('#scene').append(renderer.domElement)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.screenSpacePanning = true
scene.add(new THREE.HemisphereLight(0xffffff, 0x8aa1b8, 2.4))
const sun = new THREE.DirectionalLight(0xffffff, 2)
sun.position.set(2, -3, 5)
scene.add(sun)
const groups = new Map()
const entries = new Map()
const shapes = new Map()
let selected = null
let isolated = null
let visible = true
let wireframe = false
let pending = null

function send(kind, extra = {}) { parent.postMessage({ kind, file, ...extra }, location.origin) }
function resize() {
  const box = document.querySelector('#scene')
  camera.aspect = box.clientWidth / Math.max(box.clientHeight, 1)
  camera.updateProjectionMatrix()
  renderer.setSize(box.clientWidth, box.clientHeight, false)
}
new ResizeObserver(resize).observe(document.querySelector('#scene'))
resize()
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })
function boundsFor(group) { return new THREE.Box3().setFromObject(group || sceneGroup) }
const sceneGroup = new THREE.Group()
scene.add(sceneGroup)
function fit(group) {
  const box = boundsFor(group)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() * .5, .1)
  const distance = radius / Math.sin(camera.fov * Math.PI / 360) * .95
  controls.target.copy(center)
  camera.position.copy(center).add(new THREE.Vector3(distance * .75, -distance, distance * .7))
  camera.near = Math.max(distance / 10000, .001)
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  controls.update()
}
function updateAppearance() {
  for (const [id, group] of groups) {
    group.visible = visible && (!isolated || isolated === id)
    group.traverse(child => {
      if (!child.isMesh) return
      child.material.color.copy(id === selected ? new THREE.Color('#ec932d') : child.userData.baseColor)
      child.material.wireframe = wireframe
    })
  }
  const entry = entries.get(selected)
  document.querySelector('#element-name').textContent = entry ? entry.name || `${entry.type} #${selected}` : 'Вся модель проекта'
  document.querySelector('#element-meta').textContent = entry ? `${entry.type} · IFC #${selected} · ${entry.floor}` : `${groups.size} элементов модели`
}
function select(id, isolate = false, move = false) {
  id = id == null ? null : Number(id)
  if (id != null && !groups.has(id)) return
  selected = id
  if (isolate) isolated = isolated === id ? null : id
  if (move) fit(isolated ? groups.get(isolated) : sceneGroup)
  updateAppearance()
  send('ifc-project-selection', { expressId: id, isolated, visible })
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.data?.kind !== 'ifc-project-command') return
  const { action, expressId } = event.data
  if ((action === 'select' || action === 'isolate') && !groups.has(Number(expressId))) {
    pending = { action, expressId: Number(expressId) }
    status.textContent = `Элемент #${expressId} загружается…`
    return
  }
  if (action === 'select') select(expressId, false)
  if (action === 'isolate') { isolated = Number(expressId); visible = true; select(expressId, false, true) }
  if (action === 'all') { pending = null; isolated = null; visible = true; updateAppearance(); fit(); send('ifc-project-selection', { expressId: selected, isolated, visible }) }
  if (action === 'visible') { visible = !!event.data.visible; updateAppearance(); send('ifc-project-selection', { expressId: selected, isolated, visible }) }
})
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
function hit(event) {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  return raycaster.intersectObjects(sceneGroup.children, true)[0]?.object?.userData?.expressId
}
renderer.domElement.addEventListener('click', event => { const id = hit(event); if (id) select(id) })
renderer.domElement.addEventListener('dblclick', event => { const id = hit(event); if (id) select(id, true, true) })
document.querySelector('#fit').onclick = () => fit(isolated ? groups.get(isolated) : sceneGroup)
document.querySelector('#wire').onclick = () => { wireframe = !wireframe; updateAppearance() }

function addGeometry(api, model, entry) {
  const id = Number(entry.expressId)
  const flat = api.GetFlatMesh(model, id)
  if (!flat?.geometries?.size()) return
  const group = new THREE.Group()
  for (let i = 0; i < flat.geometries.size(); i++) {
    const placed = flat.geometries.get(i)
    let shape = shapes.get(placed.geometryExpressID)
    if (!shape) {
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
      shape = new THREE.BufferGeometry()
      shape.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      shape.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      shape.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1))
      shapes.set(placed.geometryExpressID, shape)
      geometry.delete()
    }
    const color = new THREE.Color(placed.color.x, placed.color.y, placed.color.z)
    const mesh = new THREE.Mesh(shape, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, transparent: placed.color.w < .99, opacity: placed.color.w, roughness: .82 }))
    mesh.userData = { expressId: id, baseColor: color }
    mesh.applyMatrix4(new THREE.Matrix4().fromArray(placed.flatTransformation))
    group.add(mesh)
  }
  if (group.children.length) { group.visible = visible && (!isolated || isolated === id); groups.set(id, group); sceneGroup.add(group) }
}
async function load() {
  if (!project || !file) throw Error('Не задана модель проекта')
  const prefix = `/api/projects/${encodeURIComponent(project)}/ifc/${encodeURIComponent(file)}`
  const [indexResponse, modelResponse] = await Promise.all([fetch(prefix + '/elements'), fetch(prefix)])
  if (!indexResponse.ok || !modelResponse.ok) throw Error('Не удалось загрузить IFC-модель или список элементов')
  const index = await indexResponse.json()
  const bytes = new Uint8Array(await modelResponse.arrayBuffer())
  for (const entry of index.elements) entries.set(Number(entry.expressId), entry)
  send('ifc-project-index', { elements: index.elements })
  status.textContent = `Чтение геометрии: 0 из ${index.elements.length}`
  await new Promise(resolve => requestAnimationFrame(resolve))
  const api = new WebIFC.IfcAPI()
  api.SetWasmPath('/', true)
  await api.Init()
  const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true })
  if (model < 0) throw Error('IFC-модель не открылась')
  try {
    for (let i = 0; i < index.elements.length; i++) {
      try { addGeometry(api, model, index.elements[i]) } catch (error) { console.warn('IFC element', index.elements[i].expressId, error) }
      if (pending && groups.has(pending.expressId)) {
        const command = pending; pending = null
        if (command.action === 'isolate') { isolated = command.expressId; visible = true; select(command.expressId, false, true) }
        else select(command.expressId)
      }
      if (i % 20 === 19) {
        status.textContent = `Чтение геометрии: ${i + 1} из ${index.elements.length}`
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
    }
    if (!groups.size) throw Error('В модели нет доступной 3D-геометрии')
    fit(isolated ? groups.get(isolated) : sceneGroup)
    updateAppearance()
    status.textContent = `Показано ${groups.size} элементов · клик: выделить · двойной клик: изолировать / вернуть модель`
    send('ifc-project-ready', { count: groups.size, missingIds: index.elements.map(entry => Number(entry.expressId)).filter(id => !groups.has(id)) })
  } finally { api.CloseModel(model) }
}
load().catch(error => { status.textContent = error.message; status.style.background = '#a42d2ae8'; send('ifc-project-error', { message: error.message }) })
