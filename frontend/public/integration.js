/* Connects the exact reference interface to the Spring API. */
const originalEnter = enter;
const originalLogin = login;
const originalSave = save;
const originalProjects = projects;
const originalModel = model;
const originalPassport = passport;
const originalProjectScene = projectScene;
let saveChain = Promise.resolve();

btn = function (label, action, cssClass = '') {
  return `<button type="button" class="${cssClass}" onclick="${action}">${label}</button>`;
};

function ifcViewerUrl(item) {
  const files = state.ifcFiles || [];
  const file = files.find(modelFile => modelFile.version === item.ifcVersion) || files.at(-1);
  if (!file || (!item.expressId && !item.globalId)) return null;
  const url = new URL('/viewer.html', location.origin);
  url.searchParams.set('project', activeProject);
  url.searchParams.set('file', file.fileId);
  if (item.expressId) url.searchParams.set('expressId', item.expressId);
  if (item.globalId) url.searchParams.set('globalId', item.globalId);
  url.searchParams.set('name', item.ifcName || item.mark);
  return url.toString();
}

function ifcViewer(item, height = 360) {
  const url = ifcViewerUrl(item);
  if (!url) return '';
  return `<div class="viewer" style="height:${height}px;overflow:hidden"><iframe title="3D-модель ${esc(item.id)}" src="${esc(url)}" loading="lazy" style="width:100%;height:100%;border:0"></iframe></div>`;
}

model = function () {
  const item = I();
  const url = ifcViewerUrl(item);
  if (!url) return originalModel();
  return ifcViewer(item) + `<div class="viewer-bottom"><span>Геометрия IFC · ${esc(item.globalId)}</span><a class="link" href="${esc(url)}" target="_blank">Открыть 3D на весь экран</a></div>`;
};

passport = function () {
  const item = I();
  let html = originalPassport();
  if (item.globalId) html = html.replace(`2zLJtX9pF7hQ${item.id.slice(-4)}`, esc(item.globalId));
  const names = { COLUMN: 'Колонна', BEAM: 'Балка', SLAB: 'Плита', WALL: 'Стена', FOOTING: 'Фундамент' };
  const typeName = names[item.ifcType];
  if (typeName && typeName !== 'Колонна') html = html.replace(`Колонна ${esc(item.mark)}`, `${typeName} ${esc(item.mark)}`);
  return html;
};

projectScene = function () {
  const item = I();
  const url = item && ifcViewerUrl(item);
  if (!url) return originalProjectScene();
  return `<section class="panel pad" style="margin-top:18px"><div class="flex between wrap"><h2>Модель проекта · элемент IFC</h2><a class="link" href="${esc(url)}" target="_blank">Открыть 3D на весь экран</a></div><p class="muted">Выбранная конструкция: ${esc(item.mark)} · ${esc(item.floor)} · ${esc(item.id)}. Вращайте мышью или касанием, меняйте масштаб колесом.</p>${ifcViewer(item, 470)}<div class="toolbar" style="margin-top:15px"><select aria-label="Выбранный элемент" onchange="selected=this.value;render()">${visibleItems().map(element => `<option value="${esc(element.id)}" ${element.id === selected ? 'selected' : ''}>${esc(element.mark)} · ${esc(element.floor)} · ${esc(element.id)}</option>`).join('')}</select>${btn('Открыть паспорт', 'openItem(selected)', 'primary')}</div></section>`;
};

projects = function () {
  const files = state.ifcFiles || [];
  return originalProjects() + (files.length ? `<section class="panel pad" style="margin-top:18px"><h2>Версии IFC-модели</h2>${files.map(file => `<div class="row"><span>IFC v${file.version} · ${esc(file.name)}<small style="display:block">${esc(file.uploadedBy)} · ${esc(new Date(file.uploadedAt).toLocaleString('ru-RU'))}</small></span><a class="link" href="/api/projects/${encodeURIComponent(activeProject)}/ifc/${encodeURIComponent(file.fileId)}">Скачать</a></div>`).join('')}</section>` : '');
};

function apiError(response) {
  return response.json().then(body => { throw Error(body.detail || body.message || `Ошибка сервера: ${response.status}`) });
}

enter = async function (account) {
  const password = prompt('Пароль для входа (демо: demo123)');
  if (password === null) return;
  try {
    let response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: account, password }) });
    if (!response.ok) await apiError(response);
    response = await fetch('/api/projects');
    if (!response.ok) await apiError(response);
    const projects = await response.json();
    if (account === 'customer' && !Object.keys(projects).length) {
      for (const [id, data] of Object.entries(portfolio.projects)) {
        const saved = await fetch('/api/projects/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!saved.ok) await apiError(saved);
      }
    } else {
      portfolio.projects = projects;
    }
    for (const [id, data] of Object.entries(portfolio.projects)) {
      if (data.orders?.length) data.order = data.orders.find(order => order.id === data.activeOrderId) || data.orders.find(order => order.id === data.order?.id) || data.orders[0];
      if (!projectMeta.some(meta => meta.id === id)) projectMeta.push({ id, code: id, name: data.project, address: data.address, category: data.category || 'Проект' });
    }
    if (portfolio.projects[activeProject]) state = portfolio.projects[activeProject];
    else {
      activeProject = Object.keys(portfolio.projects)[0];
      state = portfolio.projects[activeProject];
    }
    originalEnter(account);
    const target = new URLSearchParams(location.search);
    if (target.has('project') && target.has('item') && portfolio.projects[target.get('project')]) {
      switchProject(target.get('project'));
      if (visibleItems().some(item => item.id === target.get('item'))) openItem(target.get('item'));
    }
  } catch (error) { toast(error.message) }
};

login = function () {
  if (role) fetch('/api/logout', { method: 'POST' }).catch(() => {});
  originalLogin();
};

save = function () {
  originalSave();
  const id = activeProject;
  const snapshot = JSON.stringify(state);
  saveChain = saveChain.catch(() => {}).then(async () => {
    const response = await fetch('/api/projects/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: snapshot });
    if (!response.ok) await apiError(response);
  }).catch(error => toast('Не удалось сохранить на сервере: ' + error.message));
};

createProject = function () {
  need('customer');
  modal('Карточка нового проекта', field('Название проекта', 'name') + field('Адрес строительства', 'address') + field('Место получения', 'place') + field('Контактное лицо', 'contact') + textField('Описание', 'description'), form => {
    const id = 'PR-' + Date.now().toString(36).toUpperCase();
    const data = seed();
    data.projectId = id;
    data.project = form.get('name'); data.address = form.get('address'); data.place = form.get('place');
    data.contact = form.get('contact'); data.description = form.get('description');
    data.customerOrgId = users.customer.orgId;
    data.items = []; data.docs = []; data.tests = []; data.shipments = []; data.issues = []; data.events = []; data.notifications = [];
    data.version = 0; data.order.status = 'Черновик'; data.order.itemIds = []; data.order.factoryOrgId = users.factory.orgId;
    data.order.customerOrgId = users.customer.orgId; data.order.receiverOrgId = users.customer.orgId;
    data.order.projectDocIds = []; data.order.ifcVersion = 0;
    data.orders = [data.order]; data.members = []; data.category = 'Проект';
    projectMeta.push({ id, code: id, name: data.project, address: data.address, category: 'Проект' });
    portfolio.projects[id] = data;
    activeProject = id; state = data; selected = undefined; page = 'projects';
    save();
    toast('Проект создан. Загрузите IFC-модель.');
  }, 'Создать проект');
};

importIFC = function () {
  need('customer');
  modal('Импорт IFC', '<label class="field">Файл IFC4 · до 100 МБ<input name="file" type="file" required accept=".ifc"></label><div class="hint">Будут извлечены колонны, балки, плиты, стены и фундаменты. Вы выберете элементы для паспортов.</div>', form => {
    const file = form.get('file');
    if (!file || !/\.ifc$/i.test(file.name) || file.size > 100 * 1024 * 1024) throw Error('Выберите IFC до 100 МБ');
    const button = $('#modalForm button[type="submit"]');
    button.disabled = true; button.textContent = 'Чтение модели…';
    const data = new FormData(); data.append('file', file);
    saveChain.then(() => fetch('/api/projects/' + encodeURIComponent(activeProject) + '/ifc/preview', { method: 'POST', body: data }))
      .then(async response => response.ok ? response.json() : apiError(response))
      .then(report => showIfcReport(report, file.name))
      .catch(error => { toast(error.message); button.disabled = false; button.textContent = 'Прочитать IFC' });
    return false;
  }, 'Прочитать IFC');
};

function showIfcReport(report, filename) {
  const entries = report.elements;
  const counts = Object.entries(report.counts).map(([type, amount]) => `${type}: ${amount}`).join(' · ');
  const known = new Map(state.items.filter(item => item.globalId).map(item => [item.globalId, item]));
  const newCount = entries.filter(entry => !known.has(entry.globalId)).length;
  const changedCount = entries.filter(entry => known.has(entry.globalId) && (known.get(entry.globalId).ifcName !== entry.name || known.get(entry.globalId).floor !== entry.floor)).length;
  const absentCount = [...known.keys()].filter(id => !entries.some(entry => entry.globalId === id)).length;
  const body = `<div class="hint">${esc(filename)} · ${esc(report.schema)}<br>${esc(counts)}<br>Новые: ${newCount} · изменённые: ${changedCount} · отсутствуют в модели: ${absentCount}. Согласованный заказ останется на прежней версии.</div><label class="field">Поиск элемента<input id="ifcSearch" placeholder="GlobalId, название, тип" oninput="filterIfcRows()"></label><div class="flex wrap">${btn('Выбрать видимые', 'selectIfcRows(true)', 'small')}${btn('Снять выбор', 'selectIfcRows(false)', 'small')}</div><div id="ifcRows" style="max-height:360px;overflow:auto;margin-top:12px">${entries.map((entry, index) => `<label class="row ifc-row" data-search="${esc((entry.globalId + ' ' + entry.name + ' ' + entry.type).toLowerCase())}"><span><input type="checkbox" name="element" value="${index}"> ${esc(entry.name || entry.type)}<small style="display:block">${esc(entry.type)} · ${esc(entry.floor)} · ${esc(entry.globalId)}</small></span></label>`).join('')}</div>`;
  window.ifcEntries = entries;
  modal('Отчёт импорта IFC · выберите конструкции', body, form => {
    const indices = form.getAll('element').map(Number);
    if (!indices.length) throw Error('Выберите хотя бы одну конструкцию');
    const nextVersion = (state.version || 0) + 1;
    let added = 0, updated = 0;
    for (const index of indices) {
      const entry = entries[index];
      let item = state.items.find(candidate => candidate.globalId === entry.globalId);
      if (item) {
        if (item.ifcName !== entry.name || item.floor !== entry.floor || item.ifcType !== entry.type) {
          item.history ||= [];
          item.history.push({ type: 'ifc-change', old: { name: item.ifcName, floor: item.floor, type: item.ifcType }, next: { name: entry.name, floor: entry.floor, type: entry.type }, at: new Date().toISOString(), author: users[role].name });
          item.ifcName = entry.name; item.ifcType = entry.type; item.floor = entry.floor; updated++;
        }
        item.expressId = entry.expressId; item.ifcVersion = nextVersion;
        continue;
      }
      const id = 'КН-' + String(state.items.length + 1).padStart(4, '0');
      item = { id, globalId: entry.globalId, expressId: entry.expressId, ifcVersion: nextVersion, ifcName: entry.name, ifcType: entry.type,
        mark: entry.name || entry.type, floor: entry.floor || 'Не указан', factory: '', physical: '', batch: '',
        production: 'Зарегистрировано', sent: false, receipt: 'Ожидается', quality: 'Не проверено',
        qualityDoc: false, test: false, marked: false, history: [], old: [] };
      state.items.push(item); added++;
    }
    state.version = nextVersion;
    state.ifcFiles ||= [];
    state.ifcFiles.push({ version: state.version, fileId: report.fileId, name: filename, uploadedAt: new Date().toISOString(), uploadedBy: users[role].name });
    selected = state.items[0]?.id;
    log(`Импорт IFC v${state.version}: создано ${added}, обновлено ${updated}`, selected || null);
    toast(`Создано паспортов: ${added}; обновлено: ${updated}`);
  }, 'Создать паспорта');
}

window.filterIfcRows = function () {
  const term = $('#ifcSearch').value.toLowerCase();
  document.querySelectorAll('.ifc-row').forEach(row => { row.hidden = !row.dataset.search.includes(term) });
};
window.selectIfcRows = function (value) {
  document.querySelectorAll('.ifc-row:not([hidden]) input[type="checkbox"]').forEach(input => { input.checked = value });
};

qr = function () {
  requireAction('read');
  const item = getItem(selected);
  const url = new URL('/passport.html', location.origin);
  url.searchParams.set('project', activeProject);
  url.searchParams.set('item', item.id);
  const code = qrcode(0, 'M');
  code.addData(url.toString()); code.make();
  modal('Маркировка конструкции', `<div style="display:flex;justify-content:center;margin-bottom:16px">${code.createSvgTag({ cellSize: 4, margin: 4 })}</div><div class="kv"><div><span>Проектный ID</span><b>${esc(item.id)}</b></div><div><span>Заводской номер</span><b>${esc(item.factory || 'Не присвоен')}</b></div><div><span>Физическое изделие</span><b>${esc(item.physical || 'Не зарегистрировано')}</b></div></div><p><a class="link" href="${esc(url.toString())}" target="_blank">Открыть постоянную ссылку паспорта</a></p>${btn('Печать карточки', "$('#modal').close();window.print()")}${can('mark.restore') && item.physical ? btn('Зафиксировать восстановление маркировки', 'restoreMark()') : ''}`, null);
};

uploadDocument = function () {
  requireAction('document.upload');
  const kinds = factory() ? ['Паспорт качества', 'Протокол испытаний', 'Фото изделия', 'Сертификат материала'] : ['Рабочие чертежи', 'Спецификация', 'Проектные требования'];
  modal(factory() ? 'Документ качества' : 'Проектный документ', selectField('Конструкция', 'item', visibleItems().map(item => item.id)) + selectField('Тип документа', 'kind', kinds) + field('Название', 'name') + '<label class="field">Файл · PDF, JPG, PNG · до 10 МБ<input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png"></label>', form => {
    const item = getItem(form.get('item')), kind = form.get('kind'), file = form.get('file'), name = String(form.get('name')).trim();
    if (!kinds.includes(kind) || !name) throw Error('Проверьте название и тип документа');
    if (!file || !file.size || file.size > 10 * 1024 * 1024 || !/\.(pdf|jpe?g|png)$/i.test(file.name)) throw Error('Нужен PDF, JPG или PNG до 10 МБ');
    if (factory() && !item.physical) throw Error('Сначала зарегистрируйте физическое изделие');
    const button = $('#modalForm button[type="submit"]');
    button.disabled = true; button.textContent = 'Загрузка…';
    const data = new FormData(); data.append('file', file);
    saveChain.then(() => fetch('/api/projects/' + encodeURIComponent(activeProject) + '/files', { method: 'POST', body: data }))
      .then(async response => response.ok ? response.json() : apiError(response))
      .then(uploaded => {
        const source = factory() ? 'Завод' : 'ТХЗ';
        const previous = state.docs.filter(doc => doc.name === name && doc.source === source && doc.kind === kind);
        const doc = { id: uid('DOC'), fileId: uploaded.id, name, kind, version: 1 + Math.max(0, ...previous.map(doc => doc.version)), type: file.name.split('.').pop().toUpperCase(), source, date: today(), itemIds: [item.id], physicalIds: factory() ? [item.physical] : [], author: users[role].name, orgId: users[role].orgId };
        state.docs.push(doc);
        if (factory() && kind === 'Паспорт качества') item.qualityDoc = true;
        if (factory() && kind === 'Протокол испытаний') item.test = true;
        $('#modal').close();
        log('Добавлен ' + kind + ': ' + name + ' v' + doc.version, item.id);
        render(); toast('Документ загружен');
      }).catch(error => { toast(error.message); button.disabled = false; button.textContent = 'Сохранить' });
    return false;
  });
};

showDoc = function (index) {
  requireAction('read');
  const doc = state.docs[index];
  if (!visibleDocs().includes(doc)) throw Error('Документ недоступен');
  const link = doc.fileId ? `<p><a class="link" target="_blank" href="/api/projects/${encodeURIComponent(activeProject)}/files/${encodeURIComponent(doc.fileId)}">Открыть файл</a></p>` : '<p class="muted">Для демонстрационного документа файл не загружен.</p>';
  modal(esc(doc.name), `<div class="kv"><div><span>Версия</span><b>${doc.version}</b></div><div><span>Источник</span><b>${esc(doc.source)}</b></div><div><span>Область применения</span><b>${esc((doc.itemIds || []).join(', ') || 'Проект')}</b></div><div><span>Проверка ТХЗ</span><b>${doc.checked ? 'Проверено' : 'Не проверено'}</b></div></div>${link}`, can('document.verify') && !doc.checked ? () => {
    requireAction('document.verify');
    doc.checked = true; doc.review = { user: users[role].name, time: new Date().toISOString(), version: doc.version };
    log('ТХЗ проверил документ ' + doc.name + ' v' + doc.version, doc.itemIds?.[0] || null);
  } : null, 'Зафиксировать проверку');
};

// The overview lists every element in the uploaded IFC, including elements without passports.
let modelIndex = [];
let modelMissing = new Set();
let modelFileId = null;
let modelQuery = '';
let modelType = 'Все';
let modelPage = 1;
let modelSelected = null;
let modelIsolated = null;
let modelVisible = true;
function modelFrame() { return document.querySelector('#projectModelFrame'); }
function modelCommand(action, extra = {}) { modelFrame()?.contentWindow?.postMessage({ kind: 'ifc-project-command', action, ...extra }, location.origin); }
function modelMatches() { return modelIndex.filter(entry => (modelType === 'Все' || entry.type === modelType) && `${entry.name} ${entry.globalId} ${entry.expressId} ${entry.floor}`.toLowerCase().includes(modelQuery.toLowerCase())); }
function modelRows() {
  const matches = modelMatches(), pages = Math.max(1, Math.ceil(matches.length / 20));
  modelPage = Math.min(modelPage, pages);
  const current = matches.slice((modelPage - 1) * 20, modelPage * 20);
  return `<div class="muted" style="margin:8px 0">Найдено: ${matches.length} · страница ${modelPage} из ${pages}</div><div style="max-height:395px;overflow:auto">${current.map(entry => `<div class="row" style="gap:8px;${Number(entry.expressId) === modelSelected ? 'background:#e7f0fb;' : ''}"><button type="button" class="action" style="text-align:left;white-space:normal;flex:1" ${modelMissing.has(Number(entry.expressId)) ? 'disabled title="У элемента нет 3D-геометрии"' : `onclick="isolateModelElement(${Number(entry.expressId)})"`}><b>${esc(entry.name || entry.type)}</b><small style="display:block">${esc(entry.type)} · ${esc(entry.floor)} · #${esc(entry.expressId)}${modelMissing.has(Number(entry.expressId)) ? ' · без геометрии' : ''}</small></button>${visibleItems().some(item => item.globalId === entry.globalId) ? btn('Паспорт', `openModelPassport('${esc(entry.globalId)}')`, 'small') : ''}</div>`).join('') || '<div class="empty">Элементы не найдены</div>'}</div><div class="flex wrap" style="margin-top:10px"><button type="button" class="small" ${modelPage === 1 ? 'disabled' : ''} onclick="modelPage--;updateModelRows()">←</button><span>${modelPage} / ${pages}</span><button type="button" class="small" ${modelPage === pages ? 'disabled' : ''} onclick="modelPage++;updateModelRows()">→</button></div>`;
}
function updateModelRows() { const target = document.querySelector('#projectModelRows'); if (target) target.innerHTML = modelRows(); }
function isolateModelElement(id) { modelSelected = Number(id); modelIsolated = Number(id); modelVisible = true; modelCommand('isolate', { expressId: id }); updateModelRows(); updateModelPassportButton(); }
function showFullModel() { modelIsolated = null; modelVisible = true; modelCommand('all'); updateModelRows(); }
function toggleModelVisibility() { modelVisible = !modelVisible; modelCommand('visible', { visible: modelVisible }); const button = document.querySelector('#modelVisibility'); if (button) button.textContent = modelVisible ? 'Скрыть модель' : 'Показать модель'; }
function openModelPassport(globalId) { const item = visibleItems().find(entry => entry.globalId === globalId); if (item) openItem(item.id); }
function selectedModelPassport() { const entry = modelIndex.find(candidate => Number(candidate.expressId) === modelSelected); return entry && visibleItems().find(item => item.globalId === entry.globalId); }
function openSelectedModelPassport() { const item = selectedModelPassport(); if (item) openItem(item.id); }
function updateModelPassportButton() {
  const button = document.querySelector('#modelPassportButton');
  if (!button) return;
  button.disabled = !selectedModelPassport();
  button.title = modelSelected == null ? 'Выберите элемент в модели или списке' : button.disabled ? 'Для этого элемента цифровой паспорт ещё не создан' : 'Открыть цифровой паспорт выделенного элемента';
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || !event.data?.kind?.startsWith('ifc-project-')) return;
  const frame = modelFrame();
  if (!frame || event.source !== frame.contentWindow || event.data.file !== frame.dataset.file) return;
  if (event.data.kind === 'ifc-project-index') { modelIndex = event.data.elements; const filter = document.querySelector('#modelTypeFilter'); if (filter) filter.innerHTML = '<option>Все</option>' + [...new Set(modelIndex.map(entry => entry.type))].sort().map(type => `<option>${esc(type)}</option>`).join(''); updateModelRows(); updateModelPassportButton(); }
  if (event.data.kind === 'ifc-project-ready') { modelMissing = new Set(event.data.missingIds || []); updateModelRows(); }
  if (event.data.kind === 'ifc-project-selection') { modelSelected = event.data.expressId; modelIsolated = event.data.isolated; modelVisible = event.data.visible; updateModelRows(); updateModelPassportButton(); }
});
projectScene = function () {
  const files = state.ifcFiles || [];
  const file = files.find(entry => entry.fileId === modelFileId) || files.at(-1);
  if (!file) return originalProjectScene();
  const url = new URL('/project-viewer.html', location.origin);
  url.searchParams.set('project', activeProject); url.searchParams.set('file', file.fileId);
  modelIndex = []; modelMissing = new Set(); modelQuery = ''; modelType = 'Все'; modelPage = 1; modelSelected = null; modelIsolated = null; modelVisible = true;
  return `<section class="panel pad" style="margin-top:18px"><div class="flex between wrap"><h2>Модель проекта · IFC v${file.version}</h2><div class="flex wrap">${files.length > 1 ? `<select aria-label="Версия модели проекта" onchange="modelFileId=this.value;render()">${files.map(entry => `<option value="${esc(entry.fileId)}" ${entry.fileId === file.fileId ? 'selected' : ''}>IFC v${entry.version} · ${esc(entry.name)}</option>`).join('')}</select>` : ''}${btn('Показать всю модель', 'showFullModel()', 'small')}<button type="button" id="modelPassportButton" class="small primary" disabled onclick="openSelectedModelPassport()" title="Выберите элемент в модели или списке">Открыть паспорт элемента</button><button id="modelVisibility" class="small" onclick="toggleModelVisibility()">Скрыть модель</button><a class="link" href="${esc(url)}" target="_blank">Открыть 3D на весь экран</a></div></div><p class="muted">Клик по элементу выделяет его. Двойной клик оставляет только этот элемент; повторный двойной клик возвращает всю модель.</p><div class="grid two" style="align-items:start"><div class="viewer" style="height:540px;overflow:hidden"><iframe id="projectModelFrame" data-file="${esc(file.fileId)}" title="Вся IFC-модель проекта" src="${esc(url)}" style="width:100%;height:100%;border:0"></iframe></div><div><div class="toolbar"><input class="search" aria-label="Поиск элемента модели" placeholder="Название, GlobalId, этаж" oninput="modelQuery=this.value;modelPage=1;updateModelRows()"><select id="modelTypeFilter" aria-label="Фильтр типа элемента" onchange="modelType=this.value;modelPage=1;updateModelRows()"><option>Все</option></select></div><div id="projectModelRows" aria-live="polite"><div class="muted">Загрузка списка элементов…</div></div></div></div></section>`;
};

scan = function () {
  modal('Открыть паспорт по QR', `<label class="field">Фотография QR-кода<input id="qrPhoto" type="file" accept="image/*" capture="environment" onchange="decodeQrPhoto(this.files[0])"></label><div id="qrResult" class="hint">Выберите фотографию с QR-кодом. Можно также ввести ID вручную.</div>${field('ID конструкции или заводской номер', 'code', selected || '')}`, form => {
    const code = String(form.get('code') || '').trim();
    const item = visibleItems().find(entry => [entry.id, entry.factory, entry.physical].includes(code));
    if (!item) throw Error('Изделие не найдено');
    selected = item.id; page = 'passport'; tab = 'overview';
  }, 'Открыть паспорт');
};
async function decodeQrPhoto(file) {
  if (!file) return;
  const result = document.querySelector('#qrResult');
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const decoded = jsQR(pixels.data, pixels.width, pixels.height);
    if (!decoded) throw Error('QR-код не найден на фотографии');
    const url = new URL(decoded.data, location.origin);
    if (url.origin !== location.origin || url.pathname !== '/passport.html') throw Error('QR-код не относится к Digital Passport');
    const project = url.searchParams.get('project'), id = url.searchParams.get('item');
    if (!portfolio.projects[project] || !canProject(portfolio.projects[project])) throw Error('Проект из QR-кода недоступен');
    if (!itemsFor(portfolio.projects[project]).some(entry => entry.id === id)) throw Error('Паспорт из QR-кода недоступен');
    result.textContent = `Найден паспорт ${id} · ${portfolio.projects[project].project}`;
    $('#modal').close();
    if (activeProject !== project) switchProject(project);
    openItem(id);
  } catch (error) { result.textContent = error.message; result.classList.add('warn'); }
}

let registryPage = 1;
itemsTable = function () {
  const matches = visibleItems().filter(item => `${item.id} ${item.mark} ${item.factory} ${item.floor}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'Все' || item.production === filter));
  const pages = Math.max(1, Math.ceil(matches.length / 20));
  registryPage = Math.min(registryPage, pages);
  const rows = matches.slice((registryPage - 1) * 20, registryPage * 20);
  return `<div class="panel tablewrap"><table><thead><tr><th>Конструкция / ID</th><th>Заводской номер</th><th>Производство</th><th>Получение</th><th>Качество</th><th></th></tr></thead><tbody>${rows.map(item => `<tr><td><b>${esc(item.mark)} · ${esc(item.id)}</b><br><small>${esc(item.floor)}</small></td><td>${esc(item.factory || '—')}<br><small>${esc(item.physical || 'Не зарегистрировано')}</small></td><td>${badge(item.production)}</td><td>${badge(item.receipt)}</td><td>${badge(item.quality)}</td><td>${btn('Паспорт', `openItem('${item.id}')`, 'action')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Ничего не найдено. Измените запрос или фильтр.</td></tr>'}</tbody></table></div><div class="flex wrap" style="margin-top:10px"><span class="muted">Найдено: ${matches.length}</span><button class="small" ${registryPage === 1 ? 'disabled' : ''} onclick="registryPage--;updateTable()">←</button><span>${registryPage} / ${pages}</span><button class="small" ${registryPage === pages ? 'disabled' : ''} onclick="registryPage++;updateTable()">→</button></div>`;
};
const originalNewOrder = newOrder;
newOrder = function () {
  originalNewOrder();
  const list = document.querySelector('#orderItems');
  if (!list) return;
  const toolbar = list.previousElementSibling;
  if (toolbar) toolbar.remove();
  list.insertAdjacentHTML('beforebegin', `<div class="toolbar" style="margin-top:14px"><input id="orderSearch" class="search" placeholder="Поиск по названию, этажу, ID" aria-label="Поиск элементов заказа" oninput="orderListPage=1;updateOrderList()"><select id="orderFloor" aria-label="Фильтр этажа" onchange="orderListPage=1;updateOrderList()"><option value="">Все этажи</option>${[...new Set([...list.querySelectorAll('label')].map(row => row.textContent.split(' · ')[1]?.trim()).filter(Boolean))].map(floor => `<option>${esc(floor)}</option>`).join('')}</select></div><div class="flex wrap"><button type="button" class="small" onclick="selectOrderFiltered(true)">Выбрать все отфильтрованные</button><button type="button" class="small" onclick="selectOrderFiltered(false)">Снять выбор с отфильтрованных</button></div><div id="orderPager" class="flex wrap" style="margin:10px 0"></div>`);
  orderListPage = 1;
  updateOrderList();
};
let orderListPage = 1;
function orderFilteredRows() {
  const term = (document.querySelector('#orderSearch')?.value || '').toLowerCase();
  const floor = document.querySelector('#orderFloor')?.value || '';
  return [...document.querySelectorAll('#orderItems label')].filter(row => row.textContent.toLowerCase().includes(term) && (!floor || row.textContent.includes(` · ${floor} · `)));
}
function updateOrderList() {
  const all = [...document.querySelectorAll('#orderItems label')], matches = orderFilteredRows();
  const pages = Math.max(1, Math.ceil(matches.length / 20));
  orderListPage = Math.min(orderListPage, pages);
  const start = (orderListPage - 1) * 20;
  all.forEach(row => { row.hidden = true });
  matches.slice(start, start + 20).forEach(row => { row.hidden = false });
  document.querySelector('#orderPager').innerHTML = `<span class="muted">Найдено: ${matches.length} · выбрано: ${all.filter(row => row.querySelector('input').checked).length}</span><button type="button" class="small" ${orderListPage === 1 ? 'disabled' : ''} onclick="orderListPage--;updateOrderList()">←</button><span>${orderListPage} / ${pages}</span><button type="button" class="small" ${orderListPage === pages ? 'disabled' : ''} onclick="orderListPage++;updateOrderList()">→</button>`;
}
function selectOrderFiltered(value) { orderFilteredRows().forEach(row => { row.querySelector('input').checked = value }); updateOrderList(); }

const originalShowIfcReport = showIfcReport;
showIfcReport = function (...args) {
  originalShowIfcReport(...args);
  const rows = document.querySelector('#ifcRows');
  if (!rows) return;
  rows.insertAdjacentHTML('beforebegin', `<div class="toolbar"><select id="ifcTypeFilter" aria-label="Фильтр типа IFC" onchange="ifcListPage=1;updateIfcList()"><option value="">Все типы</option>${['COLUMN','BEAM','SLAB','WALL','FOOTING'].map(type => `<option>${type}</option>`).join('')}</select><span id="ifcPager" class="muted"></span><button type="button" class="small" onclick="ifcListPage--;updateIfcList()">←</button><button type="button" class="small" onclick="ifcListPage++;updateIfcList()">→</button></div>`);
  ifcListPage = 1;
  updateIfcList();
};
let ifcListPage = 1;
function ifcFilteredRows() {
  const term = (document.querySelector('#ifcSearch')?.value || '').toLowerCase();
  const type = document.querySelector('#ifcTypeFilter')?.value || '';
  return [...document.querySelectorAll('#ifcRows .ifc-row')].filter(row => row.dataset.search.includes(term) && (!type || row.dataset.search.endsWith(` ${type.toLowerCase()}`)));
}
function updateIfcList() {
  const matches = ifcFilteredRows(), pages = Math.max(1, Math.ceil(matches.length / 30));
  ifcListPage = Math.max(1, Math.min(ifcListPage, pages));
  document.querySelectorAll('#ifcRows .ifc-row').forEach(row => { row.hidden = true });
  matches.slice((ifcListPage - 1) * 30, ifcListPage * 30).forEach(row => { row.hidden = false });
  const pager = document.querySelector('#ifcPager');
  if (pager) pager.textContent = `${matches.length} элементов · ${ifcListPage} / ${pages}`;
  const buttons = pager?.parentElement?.querySelectorAll('button') || [];
  if (buttons[0]) buttons[0].disabled = ifcListPage === 1;
  if (buttons[1]) buttons[1].disabled = ifcListPage === pages;
}
filterIfcRows = function () { ifcListPage = 1; updateIfcList(); };
selectIfcRows = function (value) { ifcFilteredRows().forEach(row => { row.querySelector('input').checked = value }); updateIfcList(); };

const originalCreateShipment = createShipment;
createShipment = function () {
  originalCreateShipment();
  const dialog = document.querySelector('#modalForm');
  const choices = [...dialog?.querySelectorAll('input[name="ids"]') || []];
  if (!choices.length) return;
  choices.forEach(input => input.closest('label').classList.add('shipment-choice'));
  choices[0].closest('label').insertAdjacentHTML('beforebegin', `<div class="toolbar"><input id="shipmentSearch" class="search" placeholder="Поиск по ID или заводскому номеру" aria-label="Поиск изделий отгрузки" oninput="shipmentListPage=1;updateShipmentList()"><button type="button" class="small" onclick="selectShipmentFiltered(true)">Выбрать все отфильтрованные</button><button type="button" class="small" onclick="selectShipmentFiltered(false)">Снять выбор</button></div><div id="shipmentPager" class="flex wrap"></div>`);
  shipmentListPage = 1; updateShipmentList();
};
let shipmentListPage = 1;
function shipmentFilteredRows() {
  const term = (document.querySelector('#shipmentSearch')?.value || '').toLowerCase();
  return [...document.querySelectorAll('.shipment-choice')].filter(row => row.textContent.toLowerCase().includes(term));
}
function updateShipmentList() {
  const matches = shipmentFilteredRows(), pages = Math.max(1, Math.ceil(matches.length / 20));
  shipmentListPage = Math.max(1, Math.min(shipmentListPage, pages));
  document.querySelectorAll('.shipment-choice').forEach(row => { row.hidden = true });
  matches.slice((shipmentListPage - 1) * 20, shipmentListPage * 20).forEach(row => { row.hidden = false });
  document.querySelector('#shipmentPager').innerHTML = `<span class="muted">Найдено: ${matches.length}</span><button type="button" class="small" ${shipmentListPage === 1 ? 'disabled' : ''} onclick="shipmentListPage--;updateShipmentList()">←</button><span>${shipmentListPage} / ${pages}</span><button type="button" class="small" ${shipmentListPage === pages ? 'disabled' : ''} onclick="shipmentListPage++;updateShipmentList()">→</button>`;
}
function selectShipmentFiltered(value) { shipmentFilteredRows().forEach(row => { row.querySelector('input').checked = value }); updateShipmentList(); }

function listOptions(values, current) {
  return ['Все', ...new Set(values)].map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('');
}
function listPager(total, current, pages, changePage) {
  return `<div class="flex wrap" style="margin-top:12px"><span class="muted">Найдено: ${total}</span><button type="button" class="small" ${current === 1 ? 'disabled' : ''} onclick="${changePage}(${current - 1})">←</button><span>${current} / ${pages}</span><button type="button" class="small" ${current === pages ? 'disabled' : ''} onclick="${changePage}(${current + 1})">→</button></div>`;
}
let executionQuery = '', executionStatus = 'Все', executionDocs = 'Все', executionPage = 1, executionContext = '';
function executionMatches() {
  return visibleItems().filter(item => {
    const text = `${item.id} ${item.mark} ${item.floor} ${item.factory} ${item.physical}`.toLowerCase();
    const docs = item.qualityDoc && item.test ? 'Комплект представлен' : 'Ожидаются документы';
    return text.includes(executionQuery.toLowerCase()) &&
      (executionStatus === 'Все' || item.production === executionStatus) &&
      (executionDocs === 'Все' || docs === executionDocs);
  });
}
function executionTable() {
  const matches = executionMatches(), pages = Math.max(1, Math.ceil(matches.length / 15));
  executionPage = Math.max(1, Math.min(executionPage, pages));
  const rows = matches.slice((executionPage - 1) * 15, executionPage * 15);
  return `<div class="panel tablewrap"><table><thead><tr><th>Конструкция</th><th>Производство</th><th>Документы качества</th><th>Поставка</th><th></th></tr></thead><tbody>${rows.map(item => `<tr><td><b>${esc(item.id)} · ${esc(item.mark)}</b><br><small>${esc(item.factory || 'Изделие ещё не зарегистрировано')}</small></td><td>${badge(item.production)}</td><td>${badge(item.qualityDoc && item.test ? 'Комплект представлен' : 'Ожидаются документы')}</td><td>${badge(item.sent ? 'Отправлено' : 'Не отправлено')}</td><td>${btn('Паспорт', `openItem('${item.id}')`, 'action')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Конструкции не найдены. Измените запрос или фильтры.</td></tr>'}</tbody></table></div>${listPager(matches.length, executionPage, pages, 'setExecutionPage')}`;
}
function updateExecutionTable() { const target = document.querySelector('#executionTable'); if (target) target.innerHTML = executionTable(); }
function setExecutionPage(value) { executionPage = value; updateExecutionTable(); }
executionControl = function () {
  const context = `${activeProject}:${role}`;
  if (executionContext !== context) { executionContext = context; executionQuery = ''; executionStatus = 'Все'; executionDocs = 'Все'; executionPage = 1; }
  return title('Контроль исполнения', 'Ход изготовления заказа, готовность документов и отгрузка') + stats() +
    `<div class="toolbar"><input class="search" aria-label="Поиск в контроле исполнения" placeholder="ID, марка, этаж, заводской номер" value="${esc(executionQuery)}" oninput="executionQuery=this.value;executionPage=1;updateExecutionTable()"><select aria-label="Фильтр производства" onchange="executionStatus=this.value;executionPage=1;updateExecutionTable()">${listOptions(visibleItems().map(item => item.production), executionStatus)}</select><select aria-label="Фильтр документов качества" onchange="executionDocs=this.value;executionPage=1;updateExecutionTable()">${listOptions(['Комплект представлен', 'Ожидаются документы'], executionDocs)}</select></div><div id="executionTable">${executionTable()}</div><div class="toolbar" style="margin-top:18px">${btn('Проверить документы', "go('documents')")}${btn('Перейти к получению', "go('shipments')")}</div>`;
};

let acceptanceQuery = '', acceptanceReceipt = 'Все', acceptanceQuality = 'Все', acceptancePage = 1, acceptanceContext = '';
function acceptanceMatches() {
  return visibleItems().filter(item => {
    const text = `${item.id} ${item.mark} ${item.floor} ${item.factory} ${item.physical}`.toLowerCase();
    return text.includes(acceptanceQuery.toLowerCase()) &&
      (acceptanceReceipt === 'Все' || item.receipt === acceptanceReceipt) &&
      (acceptanceQuality === 'Все' || item.quality === acceptanceQuality);
  });
}
function acceptanceTable() {
  const matches = acceptanceMatches(), pages = Math.max(1, Math.ceil(matches.length / 15));
  acceptancePage = Math.max(1, Math.min(acceptancePage, pages));
  const rows = matches.slice((acceptancePage - 1) * 15, acceptancePage * 15);
  return `<div class="panel tablewrap"><table><thead><tr><th>Конструкция</th><th>Получение</th><th>Качество</th><th>Действие</th></tr></thead><tbody>${rows.map(item => `<tr><td><b>${esc(item.id)} · ${esc(item.mark)}</b><br><small>${esc(item.factory || 'Не зарегистрировано')}</small></td><td>${badge(item.receipt)}</td><td>${badge(item.quality)}</td><td><div class="flex wrap" style="align-items:flex-start">${btn('Паспорт изделия', `openItem('${item.id}')`, 'small')}<div>${acceptanceButton(item)}</div></div></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Конструкции не найдены. Измените запрос или фильтры.</td></tr>'}</tbody></table></div>${listPager(matches.length, acceptancePage, pages, 'setAcceptancePage')}`;
}
function updateAcceptanceTable() { const target = document.querySelector('#acceptanceTable'); if (target) target.innerHTML = acceptanceTable(); }
function setAcceptancePage(value) { acceptancePage = value; updateAcceptanceTable(); }

function acceptanceReason(item) {
  if (factory()) return 'Решение о качестве принимает технический заказчик';
  if (!item.receipt.startsWith('Получено')) return shipmentFor(item) ? 'Сначала подтвердите физическое получение изделия' : 'Нет поставки и подтверждённого получения изделия';
  if (!canReceive(item)) return 'Изделие не входит в поставку вашей организации';
  return '';
}
function acceptanceButton(item) {
  const reason = acceptanceReason(item);
  return `<button class="small primary" ${reason ? `disabled title="${esc(reason)}" aria-describedby="accept-hint-${esc(item.id)}"` : `onclick="decision('${item.id}')"`}>Принять / проверить качество</button>${reason ? `<small id="accept-hint-${esc(item.id)}" class="muted" style="display:block;margin-top:5px">${esc(reason)}</small>` : ''}`;
}
qualityPanel = function (item) {
  const html = `<div class="grid two"><section class="panel pad checks"><h2>Готовность к отгрузке</h2>${[['Регистрация изделия', !!item.factory], ['Производственная партия', !!item.batch], ['Подтверждение изготовления', ['Изготовлено','Готово к отгрузке'].includes(item.production)], ['Маркировка нанесена', item.marked], ['Паспорт качества', item.qualityDoc], ['Обязательные испытания', item.test], ['Нет открытых замечаний', !state.issues.some(issue => issue.item === item.id && issue.status !== 'Закрыто')]].map(([name, complete]) => `<div class="row"><span>${name}</span>${badge(complete ? 'Выполнено' : 'Отсутствует / требует проверки')}</div>`).join('')}${can('production.ready') && item.production === 'Изготовлено' && !item.sent ? btn('Подтвердить готовность', `ready('${item.id}')`, 'primary') : ''}</section><section class="panel pad"><h2>Проверка техзаказчиком</h2><p class="muted">Получение и качество фиксируются отдельно.</p><div class="row"><span>Физическое получение</span>${badge(item.receipt)}</div><div class="row"><span>Приёмка качества</span>${badge(item.quality)}</div><div class="hint" style="margin:16px 0">Основания: ${esc(state.order.docs)}; паспорт качества и протокол испытаний.</div>${acceptanceButton(item)}</section></div>`;
  return html;
};
acceptance = function () {
  const context = `${activeProject}:${role}`;
  if (acceptanceContext !== context) { acceptanceContext = context; acceptanceQuery = ''; acceptanceReceipt = 'Все'; acceptanceQuality = 'Все'; acceptancePage = 1; }
  return title(factory() ? 'Результаты приёмки' : 'Приёмка качества', 'Решение техзаказчика после физического получения') +
    `<div class="toolbar"><input class="search" aria-label="Поиск в приёмке качества" placeholder="ID, марка, этаж, заводской номер" value="${esc(acceptanceQuery)}" oninput="acceptanceQuery=this.value;acceptancePage=1;updateAcceptanceTable()"><select aria-label="Фильтр получения" onchange="acceptanceReceipt=this.value;acceptancePage=1;updateAcceptanceTable()">${listOptions(visibleItems().map(item => item.receipt), acceptanceReceipt)}</select><select aria-label="Фильтр качества" onchange="acceptanceQuality=this.value;acceptancePage=1;updateAcceptanceTable()">${listOptions(visibleItems().map(item => item.quality), acceptanceQuality)}</select></div><div id="acceptanceTable">${acceptanceTable()}</div>`;
};

function batchManufactureCandidates() {
  return visibleItems().filter(item => item.batch && item.factory && item.physical &&
    ['Зарегистрировано', 'В производстве'].includes(item.production) && !item.sent);
}
function updateBatchManufacturePreview() {
  const batch = document.querySelector('#modalForm select[name="batch"]')?.value;
  const target = document.querySelector('#batchManufacturePreview');
  if (!target) return;
  const items = batchManufactureCandidates().filter(item => item.batch === batch);
  const alreadyMade = visibleItems().filter(item => item.batch === batch && ['Изготовлено', 'Готово к отгрузке'].includes(item.production)).length;
  const blocked = visibleItems().filter(item => item.batch === batch && !items.includes(item) && !['Изготовлено', 'Готово к отгрузке'].includes(item.production));
  const form = items.length % 10 === 1 && items.length % 100 !== 11 ? 'изделие' : [2, 3, 4].includes(items.length % 10) && ![12, 13, 14].includes(items.length % 100) ? 'изделия' : 'изделий';
  target.innerHTML = `<div class="hint ${blocked.length ? 'warn' : ''}">Будут подтверждены ${items.length} ${form} партии ${esc(batch)}. Уже подтверждены: ${alreadyMade}.${blocked.length ? ` Сначала зарегистрируйте оставшиеся изделия: ${blocked.map(item => esc(item.id)).join(', ')}.` : ''} Документы качества и готовность к отгрузке проверяются отдельно.</div><div style="max-height:220px;overflow:auto;margin-top:10px">${items.map(item => `<div class="row"><span><b>${esc(item.id)}</b> · ${esc(item.mark)}</span><small>${esc(item.factory)} · ${esc(item.physical)}</small></div>`).join('')}</div>`;
  const submit = document.querySelector('#modalForm button[type="submit"]');
  if (submit) submit.disabled = blocked.length > 0;
}
function batchManufactureEvent(item, oldStatus, date) {
  const actor = users[role];
  const text = `Изготовление: ${oldStatus} → Изготовлено; дата ${date}; партия ${item.batch}; ${state.order.docs}`;
  const event = { id: uid('NOTICE'), createdAt: Date.now(), action: 'production.manufacture',
    destination: notificationDestination('production.manufacture', text, item.id),
    readBy: { [actor.userId]: true }, text, user: actor.name, org: actor.org,
    userId: actor.userId, orgId: actor.orgId, time: new Date().toLocaleString('ru-RU'),
    item: item.id, physical: item.physical, visibility: 'both' };
  state.events.unshift(event);
  state.notifications.unshift(event);
}
const confirmBatchManufacture = protect('production.manufacture', function () {
  const candidates = batchManufactureCandidates();
  const batches = [...new Set(candidates.map(item => item.batch))].sort();
  const initialIds = new Map(batches.map(batch => [batch, candidates.filter(item => item.batch === batch).map(item => item.id).sort().join('|')]));
  modal('Подтверждение изготовления партии',
    selectField('Производственная партия', 'batch', batches) +
    '<div id="batchManufacturePreview"></div>' +
    field('Дата изготовления', 'date', new Date().toISOString().slice(0, 10), 'date') +
    '<label class="field"><span><input name="mark" type="checkbox" required> QR нанесён, заводские номера и маркировка сверены у каждого изделия партии</span></label>',
    form => {
      const batch = String(form.get('batch'));
      const date = String(form.get('date'));
      const items = batchManufactureCandidates().filter(item => item.batch === batch);
      const blocked = visibleItems().filter(item => item.batch === batch && !items.includes(item) && !['Изготовлено', 'Готово к отгрузке'].includes(item.production));
      if (blocked.length) throw Error('Сначала зарегистрируйте все изделия партии');
      if (!initialIds.has(batch) || !items.length || items.map(item => item.id).sort().join('|') !== initialIds.get(batch))
        throw Error('Состав партии изменился. Откройте подтверждение заново.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !form.get('mark'))
        throw Error('Укажите дату и подтвердите маркировку каждого изделия');
      for (const item of items) {
        getItem(item.id);
        if (numberUsed(item.factory, item)) throw Error(`Заводской номер ${item.factory} уже используется`);
      }
      for (const item of items) {
        const oldStatus = item.production;
        item.production = 'Изготовлено';
        item.marked = true;
        item.manufacturedAt = date;
        item.manufacturingRequirements = state.order.docs;
        item.manufacturedBy = users[role].name;
        batchManufactureEvent(item, oldStatus, date);
      }
      save();
      toast(`Изготовление подтверждено: ${items.length} изделий партии ${batch}`);
    }, 'Подтвердить всю партию');
  document.querySelector('#modalForm select[name="batch"]').addEventListener('change', updateBatchManufacturePreview);
  updateBatchManufacturePreview();
}, () => {
  requireProduction();
  if (!batchManufactureCandidates().length) throw Error('Нет зарегистрированных изделий для подтверждения');
});

const originalProductionPage = production;
production = function () {
  const html = originalProductionPage();
  if (!factory() || !orderActive()) return html;
  const eligible = batchManufactureCandidates().length;
  const button = `<button type="button" class="primary" ${eligible ? 'onclick="confirmBatchManufacture()"' : 'disabled title="Нет зарегистрированных изделий в производстве"'}>Подтвердить изготовление партии</button>`;
  return html.replace('<div class="page-actions flex wrap">', `<div class="page-actions flex wrap">${button}`);
};
