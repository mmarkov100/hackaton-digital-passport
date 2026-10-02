import { chromium } from 'playwright-core'

const [projectId, fileId, expressId, globalId] = process.argv.slice(2)
if (!projectId || !fileId || (!expressId && !globalId)) throw Error('Usage: node scripts/viewer-smoke.mjs PROJECT_ID FILE_ID EXPRESS_ID [GLOBAL_ID]')
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const login = await context.request.post('http://127.0.0.1:5173/api/login', { data: { role: 'customer', password: 'demo123' } })
if (!login.ok()) throw Error(`Login failed: ${login.status()}`)
await page.goto(`http://127.0.0.1:5173/viewer.html?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(fileId)}&expressId=${encodeURIComponent(expressId || '')}&globalId=${encodeURIComponent(globalId || '')}`)
await page.waitForFunction(() => {
  const message = document.querySelector('#status')?.textContent || ''
  return message.startsWith('Элемент IFC') || document.querySelector('#status')?.style.background !== ''
}, { timeout: 120000 })
const status = await page.locator('#status').innerText()
await page.screenshot({ path: 'viewer-smoke.png' })
console.log(JSON.stringify({ status, errors }))
await browser.close()
