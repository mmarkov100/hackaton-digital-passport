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
  await app.evaluate(() => switchProject(projectMeta.find(meta => meta.name.includes('IFC'))?.id))
  await frame.locator('#projectModelFrame').waitFor()
  await frame.locator('#projectModelRows .row').first().waitFor({ timeout: 120000 })
  await app.evaluate(() => {
    const item = visibleItems().find(candidate => candidate.globalId)
    const entry = modelIndex.find(candidate => candidate.globalId === item.globalId)
    isolateModelElement(entry.expressId)
  })
  assert.equal(await frame.locator('#modelPassportButton').isEnabled(), true)
  const passportId = await app.evaluate(() => selectedModelPassport().id)
  await frame.locator('#modelPassportButton').click()
  assert.equal(await app.evaluate(() => selected), passportId)
  assert.equal(await app.evaluate(() => page), 'passport')

  await app.evaluate(() => {
    for (let number = 1; number <= 45; number++) {
      state.items.push({ id: `TEST-${String(number).padStart(3, '0')}`, mark: `TEST-${String(number).padStart(3, '0')}`,
        floor: number <= 20 ? 'Этаж A' : 'Этаж B', factory: '', physical: '', batch: '',
        production: number <= 20 ? 'Зарегистрировано' : 'Изготовлено', sent: false,
        receipt: number <= 20 ? 'Ожидается' : 'Получено', quality: number <= 20 ? 'Не проверено' : 'Принято',
        qualityDoc: number <= 10, test: number <= 10, marked: false, old: [], history: [] })
    }
    go('production')
  })
  await frame.getByRole('textbox', { name: 'Поиск в контроле исполнения' }).fill('TEST-')
  assert.equal(await frame.locator('#executionTable tbody tr').count(), 15)
  assert.match(await frame.locator('#executionTable').innerText(), /45/)
  await frame.locator('#executionTable button').filter({ hasText: '→' }).click()
  assert.match(await frame.locator('#executionTable tbody tr').first().innerText(), /TEST-016/)
  await frame.getByRole('combobox', { name: 'Фильтр производства' }).selectOption('Изготовлено')
  assert.match(await frame.locator('#executionTable').innerText(), /Найдено: 25/)
  await frame.getByRole('combobox', { name: 'Фильтр документов качества' }).selectOption('Комплект представлен')
  assert.match(await frame.locator('#executionTable').innerText(), /Найдено: 0/)

  await app.evaluate(() => go('acceptance'))
  await frame.getByRole('textbox', { name: 'Поиск в приёмке качества' }).fill('TEST-')
  assert.equal(await frame.locator('#acceptanceTable tbody tr').count(), 15)
  await frame.locator('#acceptanceTable button').filter({ hasText: '→' }).click()
  assert.match(await frame.locator('#acceptanceTable tbody tr').first().innerText(), /TEST-016/)
  await frame.getByRole('combobox', { name: 'Фильтр получения' }).selectOption('Получено')
  assert.match(await frame.locator('#acceptanceTable').innerText(), /Найдено: 25/)
  await frame.getByRole('combobox', { name: 'Фильтр качества' }).selectOption('Не проверено')
  assert.match(await frame.locator('#acceptanceTable').innerText(), /Найдено: 0/)

  await app.evaluate(() => newOrder())
  await frame.locator('#orderItems').waitFor()
  await frame.locator('#orderSearch').fill('TEST-')
  assert.equal(await frame.locator('#orderItems label:visible').count(), 20)
  await frame.locator('#orderPager button').filter({ hasText: '→' }).click()
  assert.equal(await frame.locator('#orderItems label:visible').count(), 20)
  assert.match(await frame.locator('#orderItems label:visible').first().innerText(), /TEST-021/)
  await frame.locator('#orderSearch').fill('TEST-035')
  assert.equal(await frame.locator('#orderItems label:visible').count(), 1)
  assert.match(await frame.locator('#orderItems label:visible').first().innerText(), /TEST-035/)
  await frame.getByRole('button', { name: 'Выбрать все отфильтрованные' }).click()
  assert.equal(await frame.locator('#orderItems input:checked').count(), 1)
  await frame.locator('#orderSearch').fill('TEST-')
  await frame.getByRole('button', { name: 'Выбрать все отфильтрованные' }).click()
  assert.equal(await frame.locator('#orderItems input:checked').count(), 45)
  assert.equal(await frame.locator('#orderItems label:visible').count(), 20)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passportId, execution: 'ok', acceptance: 'ok', order: 'ok', errors }))
} finally { await browser.close() }
