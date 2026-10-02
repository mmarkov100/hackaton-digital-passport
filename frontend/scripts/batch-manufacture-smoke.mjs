import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('dialog', dialog => dialog.accept('demo123'))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5173/')
  const frame = page.frameLocator('iframe[title="Digital Passport"]')
  await frame.getByRole('button', { name: /Технический заказчик/ }).click()
  await frame.locator('.project-card').first().waitFor()
  const app = page.frame({ url: /passport\.html/ })
  await app.evaluate(() => { switchProject('PR-026'); go('acceptance') })
  const firstId = await app.evaluate(() => visibleItems()[0].id)
  await frame.locator('#acceptanceTable').getByRole('button', { name: 'Паспорт изделия' }).first().click()
  assert.equal(await app.evaluate(() => selected), firstId)
  assert.equal(await app.evaluate(() => page), 'passport')

  await app.evaluate(() => login())
  await frame.getByRole('button', { name: /Представитель завода/ }).click()
  await frame.locator('.sidebar').waitFor()
  await app.evaluate(() => {
    activeProject = 'PR-026'; state = portfolio.projects[activeProject]
    state.order = state.orders.find(order => order.status !== 'Черновик') || state.order
    let saves = 0
    save = () => { saves++ }
    window.bulkTestSaves = () => saves
    for (let number = 1; number <= 4; number++) {
      const id = `BULK-TEST-${number}`
      state.items.push({ id, mark: 'ТЕСТ', floor: 'Тестовый этаж', factory: `BULK-NUMBER-${number}`,
        physical: `BULK-PHYSICAL-${number}`, batch: 'П-ТЕСТ',
        production: number === 4 ? 'Изготовлено' : 'В производстве', sent: false,
        receipt: 'Ожидается', quality: 'Не проверено', qualityDoc: false, test: false,
        marked: number === 4, old: [], history: [] })
      state.order.itemIds.push(id)
    }
    window.bulkBeforeEvents = state.events.length
    go('production')
  })
  await frame.getByRole('button', { name: 'Подтвердить изготовление партии' }).click()
  await frame.locator('dialog[open] select[name="batch"]').selectOption('П-ТЕСТ')
  assert.match(await frame.locator('#batchManufacturePreview').innerText(), /Будут подтверждены 3 изделия/)
  await frame.locator('dialog[open] input[name="date"]').fill('2026-10-02')
  await frame.locator('dialog[open] input[name="mark"]').check()
  await frame.locator('dialog[open] button[type="submit"]').click()
  await frame.locator('dialog[open]').waitFor({ state: 'hidden' })
  const outcome = await app.evaluate(() => ({
    items: state.items.filter(item => item.id.startsWith('BULK-TEST-')).map(item => ({ id: item.id, production: item.production, marked: item.marked, manufacturedAt: item.manufacturedAt })),
    newEvents: state.events.length - window.bulkBeforeEvents,
    saves: window.bulkTestSaves(),
  }))
  assert.equal(outcome.items.length, 4)
  assert(outcome.items.every(item => item.production === 'Изготовлено' && item.marked))
  assert(outcome.items.slice(0, 3).every(item => item.manufacturedAt === '2026-10-02'))
  assert.equal(outcome.newEvents, 3)
  assert.equal(outcome.saves, 1)
  await app.evaluate(() => {
    for (let number = 1; number <= 2; number++) {
      const id = `BULK-BLOCKED-${number}`
      state.items.push({ id, mark: 'ТЕСТ', floor: 'Тестовый этаж', factory: number === 1 ? 'BULK-BLOCKED-NUMBER' : '',
        physical: number === 1 ? 'BULK-BLOCKED-PHYSICAL' : '', batch: 'П-БЛОК',
        production: 'В производстве', sent: false, receipt: 'Ожидается', quality: 'Не проверено',
        qualityDoc: false, test: false, marked: false, old: [], history: [] })
      state.order.itemIds.push(id)
    }
    render()
  })
  await frame.getByRole('button', { name: 'Подтвердить изготовление партии' }).click()
  await frame.locator('dialog[open] select[name="batch"]').selectOption('П-БЛОК')
  assert.match(await frame.locator('#batchManufacturePreview').innerText(), /Сначала зарегистрируйте оставшиеся изделия/)
  assert.equal(await frame.locator('dialog[open] button[type="submit"]').isDisabled(), true)
  await frame.locator('dialog[open] button[aria-label="Закрыть"]').click()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passportId: firstId, batch: outcome, errors }))
} finally { await browser.close() }
