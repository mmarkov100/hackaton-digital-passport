/* Connects the exact reference interface to the Spring API. */
const originalEnter = enter;
const originalLogin = login;
const originalSave = save;
const originalProjects = projects;
const originalModel = model;
const originalPassport = passport;
const originalProjectScene = projectScene;
let saveChain = Promise.resolve();

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
