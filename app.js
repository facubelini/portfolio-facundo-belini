/* ================================================================
   PORTFOLIO — app.js
   Modelo de seguridad:
   ─ Palabra clave  → verificada por sesión (sessionStorage)
   ─ PAT            → localStorage, ingresado una sola vez
   ─ owner/repo/branch → hardcodeados (el repo es público de todas formas)
   ─ DOM de edición → inyectado SOLO después de verificación
   ─ Write API      → doble-check isEditorActive() antes de cada fetch
   ================================================================ */

'use strict';

/* ─── Config del repositorio ─────────────────────────────────────── */
const GH_OWNER  = 'facubelini';
const GH_REPO   = 'portfolio-facundo-belini';
const GH_BRANCH = 'main';

/* ─── Constantes ─────────────────────────────────────────────────── */
const KEYWORD        = 'Blogdelporta1!';
const MAX_ATTEMPTS   = 5;
const LOCKOUT_MS     = 5 * 60 * 1000;
const GH_PAT_KEY     = 'pflio_pat';
const EDITOR_SES_KEY = 'pflio_editor_active';
const GH_API         = 'https://api.github.com';

/* ─── Estado ─────────────────────────────────────────────────────── */
const state = {
  projects:       [],
  certifications: [],
  about:          { bio: '', role: '' },
  activeFilter:   'Todos',
  failedAttempts: 0,
  lockoutUntil:   null,
};

/* ════════════════════════════════════════════════════════════════════
   SESIÓN Y CONFIG
   ════════════════════════════════════════════════════════════════════ */

const isEditorActive  = () => sessionStorage.getItem(EDITOR_SES_KEY) === 'true';
const activateSession = () => sessionStorage.setItem(EDITOR_SES_KEY, 'true');
const clearSession    = () => sessionStorage.removeItem(EDITOR_SES_KEY);

function getGHConfig() {
  const pat = localStorage.getItem(GH_PAT_KEY);
  if (!pat) return null;
  return { owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH, pat };
}
function savePAT(pat) { localStorage.setItem(GH_PAT_KEY, pat); }

function lockoutRemaining() {
  if (!state.lockoutUntil) return 0;
  const rem = state.lockoutUntil - Date.now();
  if (rem <= 0) { state.lockoutUntil = null; return 0; }
  return rem;
}

/* ════════════════════════════════════════════════════════════════════
   GITHUB API
   ════════════════════════════════════════════════════════════════════ */

function ghHeaders(pat) {
  return {
    'Authorization': `token ${pat}`,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
  };
}

async function ghGetFile(path, cfg) {
  const url = `${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${cfg.branch}&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: { ...ghHeaders(cfg.pat), 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const binary = atob(data.content.replace(/\n/g, ''));
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { sha: data.sha, content: new TextDecoder('utf-8').decode(bytes) };
}

async function ghPutTextFile(path, text, sha, msg, cfg) {
  if (!isEditorActive()) throw new Error('Sesión inactiva — operación cancelada.');
  const body = { message: msg, content: textToBase64(text), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(`${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'PUT', headers: ghHeaders(cfg.pat), body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub ${res.status}`);
  }
  return res.json();
}

async function ghPutBinaryFile(path, base64, sha, msg, cfg) {
  if (!isEditorActive()) throw new Error('Sesión inactiva — operación cancelada.');
  const body = { message: msg, content: base64, branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(`${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'PUT', headers: ghHeaders(cfg.pat), body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub ${res.status}`);
  }
  return res.json();
}

async function ghDeleteFile(path, sha, msg, cfg) {
  if (!isEditorActive()) throw new Error('Sesión inactiva — operación cancelada.');
  const res = await fetch(`${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'DELETE', headers: ghHeaders(cfg.pat),
    body: JSON.stringify({ message: msg, sha, branch: cfg.branch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub ${res.status}`);
  }
  return res.json();
}

/* ════════════════════════════════════════════════════════════════════
   CARGA DE DATOS
   ════════════════════════════════════════════════════════════════════ */

async function loadProjects() {
  try {
    const res = await fetch(`./projects.json?t=${Date.now()}`);
    if (!res.ok) throw new Error();
    state.projects = (await res.json()).projects || [];
  } catch { state.projects = []; }
}

async function loadAbout() {
  try {
    const res = await fetch(`./about.json?t=${Date.now()}`);
    if (!res.ok) throw new Error();
    const d = await res.json();
    state.about = { bio: d.bio || '', role: d.role || '' };
  } catch { state.about = { bio: '', role: '' }; }
}

async function loadCertifications() {
  try {
    const res = await fetch(`./certifications.json?t=${Date.now()}`);
    if (!res.ok) throw new Error();
    state.certifications = (await res.json()).certifications || [];
  } catch { state.certifications = []; }
}

/* ════════════════════════════════════════════════════════════════════
   RENDER — PROYECTOS
   ════════════════════════════════════════════════════════════════════ */

function renderAll() {
  renderCategories();
  renderProjects(state.activeFilter);
  updateCounter();
}

function renderCategories() {
  const container  = document.getElementById('filters-container');
  const categories = ['Todos', ...new Set(state.projects.map(p => p.category).filter(Boolean))];
  container.innerHTML = categories.map(cat => `
    <button class="filter-btn${cat === state.activeFilter ? ' active' : ''}" data-cat="${escHtml(cat)}">
      ${escHtml(cat)}
    </button>
  `).join('');
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeFilter = btn.dataset.cat;
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderProjects(state.activeFilter);
    });
  });
}

function renderProjects(filter) {
  const grid  = document.getElementById('projects-grid');
  const empty = document.getElementById('empty-state');
  const list  = filter === 'Todos' ? state.projects : state.projects.filter(p => p.category === filter);

  if (list.length === 0) { grid.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden   = true;
  grid.innerHTML = list.map((p, i) => buildCardHTML(p, i)).join('');
  if (isEditorActive()) attachDeleteHandlers();
}

function buildCardHTML(project, idx) {
  const id  = escHtml(project.id || '');
  const img = project.image
    ? `<div class="card-img-wrap"><img src="./${escHtml(project.image)}" alt="${escHtml(project.title)}" class="card-img" loading="lazy" /></div>`
    : `<div class="card-img-wrap card-img-placeholder"><span class="placeholder-label" aria-hidden="true">${escHtml(project.category || '—')}</span></div>`;
  const tags   = (project.technologies || []).map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('');
  const delBtn = isEditorActive()
    ? `<button class="card-delete-btn" data-id="${id}" aria-label="Eliminar" title="Eliminar">×</button>` : '';

  return `
    <article class="project-card" data-id="${id}" style="--card-i:${idx}">
      ${delBtn}${img}
      <div class="card-body">
        <span class="card-category">${escHtml(project.category || '')}</span>
        <h2 class="card-title">${escHtml(project.title)}</h2>
        ${project.date ? `<time class="card-date" datetime="${escHtml(project.date)}">${formatDate(project.date)}</time>` : ''}
        <p class="card-desc">${escHtml(project.description || '')}</p>
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      </div>
    </article>`.trim();
}

function attachDeleteHandlers() {
  document.querySelectorAll('.card-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showDeleteConfirm(btn.dataset.id, btn.closest('.project-card'));
    });
  });
}

function showDeleteConfirm(projectId, cardEl) {
  cardEl.querySelector('.card-confirm-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-confirm-overlay';
  overlay.innerHTML = `
    <p class="confirm-msg">¿Eliminar este proyecto?</p>
    <div class="confirm-btns">
      <button class="btn btn-danger confirm-yes">Sí, eliminar</button>
      <button class="btn btn-ghost confirm-no">Cancelar</button>
    </div>`;
  cardEl.appendChild(overlay);
  overlay.querySelector('.confirm-no').addEventListener('click',  () => overlay.remove());
  overlay.querySelector('.confirm-yes').addEventListener('click', () => { overlay.remove(); deleteProject(projectId); });
}

function updateCounter() {
  const el = document.getElementById('project-count');
  if (el) el.textContent = state.projects.length;
}

/* ════════════════════════════════════════════════════════════════════
   RENDER — ABOUT ME
   ════════════════════════════════════════════════════════════════════ */

function renderAbout() {
  const section = document.getElementById('about-section');
  if (!section) return;
  const { bio, role } = state.about;

  if (!bio && !isEditorActive()) { section.style.display = 'none'; return; }
  section.style.display = '';

  const editBtn = isEditorActive()
    ? `<button class="about-edit-btn" id="about-edit-btn">Editar</button>` : '';

  const bioHTML = bio
    ? `<p class="about-bio">${escHtml(bio).replace(/\n/g, '<br>')}</p>
       ${role ? `<p class="about-role">${escHtml(role)}</p>` : ''}`
    : `<p class="about-bio" style="color:var(--fg-faint);font-style:italic;">Hacé clic en "Editar" para escribir tu bio.</p>`;

  section.innerHTML = `
    <span class="about-label">Sobre mí</span>
    <div class="about-body">${editBtn}${bioHTML}</div>`;

  document.getElementById('about-edit-btn')?.addEventListener('click', showAboutEditModal);
}

/* ════════════════════════════════════════════════════════════════════
   RENDER — CERTIFICACIONES
   ════════════════════════════════════════════════════════════════════ */

function renderCertifications() {
  const section = document.getElementById('certs-section');
  if (!section) return;
  const { certifications } = state;

  if (certifications.length === 0 && !isEditorActive()) { section.style.display = 'none'; return; }
  section.style.display = '';

  const addBtn = isEditorActive()
    ? `<button class="add-cert-btn" id="add-cert-btn">
         <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
           <line x1="5.5" y1="1" x2="5.5" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
           <line x1="1" y1="5.5" x2="10" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
         </svg>
         Agregar
       </button>` : '';

  const cardsHTML = certifications.length > 0
    ? `<div class="certs-grid">${certifications.map((c, i) => buildCertCardHTML(c, i)).join('')}</div>`
    : `<div class="certs-empty">No hay certificaciones todavía.</div>`;

  section.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Certificaciones <em>&</em> cursos</h2>
      ${addBtn}
    </div>
    ${cardsHTML}`;

  document.getElementById('add-cert-btn')?.addEventListener('click', showCertFormModal);

  if (isEditorActive()) {
    section.querySelectorAll('.cert-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showCertDeleteConfirm(btn.dataset.id, btn.closest('.cert-card'));
      });
    });
  }
}

function buildCertCardHTML(cert, idx) {
  const id     = escHtml(cert.id || '');
  const delBtn = isEditorActive()
    ? `<button class="cert-delete-btn" data-id="${id}" aria-label="Eliminar" title="Eliminar">×</button>` : '';
  const imgEl = cert.image
    ? `<div class="cert-img-wrap"><img src="./${escHtml(cert.image)}" alt="${escHtml(cert.title)}" class="cert-img" loading="lazy" /></div>` : '';
  const linkEl = cert.link
    ? `<a class="cert-link" href="${escHtml(cert.link)}" target="_blank" rel="noopener noreferrer">Ver certificado</a>` : '';

  return `
    <div class="cert-card" data-id="${id}" style="--card-i:${idx}">
      ${delBtn}
      ${imgEl}
      <p class="cert-institution">${escHtml(cert.institution || '')}</p>
      <h3 class="cert-title">${escHtml(cert.title)}</h3>
      ${cert.date ? `<time class="cert-date" datetime="${escHtml(cert.date)}">${formatDate(cert.date)}</time>` : ''}
      ${cert.description ? `<p class="cert-desc">${escHtml(cert.description)}</p>` : ''}
      ${linkEl}
    </div>`.trim();
}

function showCertDeleteConfirm(certId, cardEl) {
  cardEl.querySelector('.card-confirm-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-confirm-overlay';
  overlay.innerHTML = `
    <p class="confirm-msg">¿Eliminar esta certificación?</p>
    <div class="confirm-btns">
      <button class="btn btn-danger confirm-yes">Sí, eliminar</button>
      <button class="btn btn-ghost confirm-no">Cancelar</button>
    </div>`;
  cardEl.appendChild(overlay);
  overlay.querySelector('.confirm-no').addEventListener('click',  () => overlay.remove());
  overlay.querySelector('.confirm-yes').addEventListener('click', () => { overlay.remove(); deleteCert(certId); });
}

/* ════════════════════════════════════════════════════════════════════
   MODAL
   ════════════════════════════════════════════════════════════════════ */

function showModal(html, type = '') {
  const overlay = document.getElementById('modal-overlay');
  const box     = document.getElementById('modal-box');
  box.innerHTML = html;
  box.className = type ? `modal-box modal-box--${type}` : 'modal-box';
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.onclick = e => { if (e.target === overlay) hideModal(); };
  if (!type) setTimeout(() => box.querySelector('input, textarea')?.focus(), 60);
}

function hideModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.onclick = null;
  setTimeout(() => {
    const box = document.getElementById('modal-box');
    box.innerHTML = '';
    box.className = 'modal-box';
  }, 220);
}

/* ════════════════════════════════════════════════════════════════════
   DETAIL MODALS — VER EN DETALLE
   ════════════════════════════════════════════════════════════════════ */

function showProjectDetailModal(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const imgHTML = project.image
    ? `<div class="detail-img-wrap"><img src="./${escHtml(project.image)}" class="detail-img" alt="${escHtml(project.title)}" loading="lazy" /></div>`
    : '';
  const tags = (project.technologies || []).map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('');
  showModal(`
    ${imgHTML}
    <div class="detail-body">
      <button class="detail-close" onclick="hideModal()" aria-label="Cerrar">×</button>
      <div class="detail-meta">
        ${project.category ? `<span class="detail-category">${escHtml(project.category)}</span>` : ''}
        ${project.date ? `<time class="detail-date">${formatDate(project.date)}</time>` : ''}
      </div>
      <h2 class="detail-title">${escHtml(project.title)}</h2>
      ${project.description ? `<p class="detail-desc">${escHtml(project.description).replace(/\n/g, '<br>')}</p>` : ''}
      ${tags ? `<div class="detail-tags">${tags}</div>` : ''}
    </div>`, 'detail');
}

function showCertDetailModal(certId) {
  const cert = state.certifications.find(c => c.id === certId);
  if (!cert) return;
  const imgHTML = cert.image
    ? `<div class="detail-img-wrap detail-img-wrap--cert"><img src="./${escHtml(cert.image)}" class="detail-img detail-img--cert" alt="${escHtml(cert.title)}" loading="lazy" /></div>`
    : '';
  const linkHTML = cert.link
    ? `<a class="detail-link" href="${escHtml(cert.link)}" target="_blank" rel="noopener noreferrer">Ver certificado</a>`
    : '';
  showModal(`
    ${imgHTML}
    <div class="detail-body">
      <button class="detail-close" onclick="hideModal()" aria-label="Cerrar">×</button>
      <div class="detail-meta">
        ${cert.institution ? `<span class="detail-category">${escHtml(cert.institution)}</span>` : ''}
        ${cert.date ? `<time class="detail-date">${formatDate(cert.date)}</time>` : ''}
      </div>
      <h2 class="detail-title">${escHtml(cert.title)}</h2>
      ${cert.description ? `<p class="detail-desc">${escHtml(cert.description).replace(/\n/g, '<br>')}</p>` : ''}
      ${linkHTML}
    </div>`, 'detail');
}

/* ════════════════════════════════════════════════════════════════════
   GATE — PALABRA CLAVE
   ════════════════════════════════════════════════════════════════════ */

function showKeywordModal() {
  const rem = lockoutRemaining();
  if (rem > 0) {
    const mins = Math.ceil(rem / 60000);
    showModal(`
      <div class="modal-header">
        <h3 class="modal-title">Acceso bloqueado</h3>
        <button class="modal-close" onclick="hideModal()">×</button>
      </div>
      <p class="modal-msg modal-msg--error">Demasiados intentos. Intentá en ${mins} minuto${mins !== 1 ? 's' : ''}.</p>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="hideModal()">Cerrar</button></div>`);
    return;
  }
  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">Modo editor</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <p class="modal-sub">Ingresá la palabra clave para continuar.</p>
    <div class="form-group">
      <label class="form-label" for="kw-input">Palabra clave</label>
      <input id="kw-input" type="password" class="form-input" autocomplete="off" placeholder="••••••••••••" />
    </div>
    <div id="kw-error" class="form-error" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="kw-btn">Continuar →</button>
    </div>`);

  const input = document.getElementById('kw-input');
  const errEl = document.getElementById('kw-error');
  const btn   = document.getElementById('kw-btn');
  const go    = () => handleKeywordSubmit(input.value, errEl, btn, input);
  btn.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

function handleKeywordSubmit(value, errEl, btn, input) {
  if (value === KEYWORD) {
    state.failedAttempts = 0;
    activateSession();
    activateEditorMode();
    hideModal();
    setTimeout(() => {
      if (!localStorage.getItem(GH_PAT_KEY)) showTokenModal();
      else showProjectFormModal();
    }, 260);
    return;
  }
  state.failedAttempts++;
  if (state.failedAttempts >= MAX_ATTEMPTS) {
    state.lockoutUntil = Date.now() + LOCKOUT_MS;
    showError(errEl, `Bloqueado por ${LOCKOUT_MS / 60000} minutos.`);
    btn.disabled = true;
    return;
  }
  const left = MAX_ATTEMPTS - state.failedAttempts;
  showError(errEl, `Incorrecta. ${left} intento${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''}.`);
  if (input) { input.value = ''; input.focus(); }
}

/* ════════════════════════════════════════════════════════════════════
   MODAL TOKEN (primera vez)
   ════════════════════════════════════════════════════════════════════ */

function showTokenModal() {
  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">Token de GitHub</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <p class="modal-sub">Solo necesitás ingresarlo una vez — se guarda en tu navegador.</p>
    <div class="form-group">
      <label class="form-label" for="tok-input">Personal Access Token <span class="req">*</span></label>
      <input id="tok-input" type="password" class="form-input" placeholder="github_pat_..." autocomplete="off" />
    </div>
    <div id="tok-error" class="form-error" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="tok-save">Guardar →</button>
    </div>`);
  const input = document.getElementById('tok-input');
  const errEl = document.getElementById('tok-error');
  const btn   = document.getElementById('tok-save');
  const save  = () => {
    const pat = input.value.trim();
    if (!pat) { showError(errEl, 'Ingresá el token.'); return; }
    savePAT(pat);
    hideModal();
    setTimeout(() => showProjectFormModal(), 260);
  };
  btn.addEventListener('click', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

/* ════════════════════════════════════════════════════════════════════
   MODO EDITOR
   ════════════════════════════════════════════════════════════════════ */

function activateEditorMode() {
  if (!document.getElementById('editor-indicator')) {
    const header = document.querySelector('.site-header');
    const ind    = document.createElement('div');
    ind.id = 'editor-indicator'; ind.className = 'editor-indicator';
    ind.innerHTML = `
      <span class="editor-dot" aria-hidden="true"></span>
      <span class="editor-label">Modo editor</span>
      <button class="editor-exit-btn" id="editor-exit-btn">Salir</button>`;
    const right = header.querySelector('.header-right');
    if (right) right.prepend(ind); else header.appendChild(ind);
    document.getElementById('editor-exit-btn').addEventListener('click', deactivateEditorMode);
  }
  renderProjects(state.activeFilter);
  renderAbout();
  renderCertifications();
}

function deactivateEditorMode() {
  clearSession();
  document.getElementById('editor-indicator')?.remove();
  renderProjects(state.activeFilter);
  renderAbout();
  renderCertifications();
}

/* ════════════════════════════════════════════════════════════════════
   MODAL NUEVO PROYECTO
   ════════════════════════════════════════════════════════════════════ */

function showProjectFormModal() {
  if (!isEditorActive()) { showKeywordModal(); return; }
  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">Nuevo proyecto</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-title">Título <span class="req">*</span></label>
      <input id="pf-title" type="text" class="form-input" placeholder="Mi proyecto" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="pf-cat">Categoría <span class="req">*</span></label>
        <input id="pf-cat" type="text" class="form-input" placeholder="Diseño" />
      </div>
      <div class="form-group">
        <label class="form-label" for="pf-date">Fecha</label>
        <input id="pf-date" type="month" class="form-input" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-desc">Descripción</label>
      <textarea id="pf-desc" class="form-textarea" placeholder="Descripción breve…"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-tech">Tecnologías / medios <span class="hint">(separados por coma)</span></label>
      <input id="pf-tech" type="text" class="form-input" placeholder="HTML, CSS, Figma" />
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-img">Imagen <span class="hint">(opcional)</span></label>
      <input id="pf-img" type="file" class="form-file" accept="image/*" />
      <div class="image-preview-wrap" id="img-preview-wrap" hidden>
        <img id="img-preview" class="image-preview" alt="Vista previa" />
      </div>
    </div>
    <div id="pf-status" class="upload-status" hidden></div>
    <div id="pf-error"  class="form-error"    hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="pf-submit">Publicar →</button>
    </div>`);

  document.getElementById('pf-img').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('img-preview').src = ev.target.result;
      document.getElementById('img-preview-wrap').hidden = false;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('pf-submit').addEventListener('click', submitNewProject);
}

async function submitNewProject() {
  if (!isEditorActive()) { hideModal(); showKeywordModal(); return; }
  const title    = document.getElementById('pf-title').value.trim();
  const category = document.getElementById('pf-cat').value.trim();
  const date     = document.getElementById('pf-date').value;
  const desc     = document.getElementById('pf-desc').value.trim();
  const tech     = document.getElementById('pf-tech').value.trim();
  const imgFile  = document.getElementById('pf-img').files[0];
  const errEl    = document.getElementById('pf-error');
  const statusEl = document.getElementById('pf-status');
  const submitBtn= document.getElementById('pf-submit');

  if (!title || !category) { showError(errEl, 'Título y categoría son obligatorios.'); return; }
  const cfg = getGHConfig();
  if (!cfg) { hideModal(); showTokenModal(); return; }

  submitBtn.disabled = true; errEl.hidden = true;
  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg; statusEl.hidden = false;
  };

  const project = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title, category, date: date || null, description: desc,
    technologies: tech ? tech.split(',').map(t => t.trim()).filter(Boolean) : [],
    image: null,
  };

  try {
    if (imgFile) {
      setStatus('Subiendo imagen…');
      const base64 = await readFileAsBase64(imgFile);
      const ext    = imgFile.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fname  = `images/${project.id}.${ext}`;
      await ghPutBinaryFile(fname, base64, null, `Add image: ${title}`, cfg);
      project.image = fname;
    }
    setStatus('Guardando proyecto…');
    const existing = await ghGetFile('projects.json', cfg);
    let sha = null; let data = { projects: [] };
    if (existing) { sha = existing.sha; data = JSON.parse(existing.content); }
    if (!Array.isArray(data.projects)) data.projects = [];
    data.projects.push(project);
    await ghPutTextFile('projects.json', JSON.stringify(data, null, 2), sha, `Add project: ${title}`, cfg);
    state.projects.push(project);
    renderAll();
    setStatus('¡Proyecto publicado!', 'success');
    setTimeout(hideModal, 1800);
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    submitBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════════════
   MODAL NUEVA CERTIFICACIÓN
   ════════════════════════════════════════════════════════════════════ */

function showCertFormModal() {
  if (!isEditorActive()) { showKeywordModal(); return; }
  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">Nueva certificación</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label" for="cf-title">Título <span class="req">*</span></label>
      <input id="cf-title" type="text" class="form-input" placeholder="Nombre del curso o certificación" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="cf-inst">Institución / Plataforma <span class="req">*</span></label>
        <input id="cf-inst" type="text" class="form-input" placeholder="Udemy, Coursera…" />
      </div>
      <div class="form-group">
        <label class="form-label" for="cf-date">Fecha</label>
        <input id="cf-date" type="month" class="form-input" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="cf-desc">Descripción <span class="hint">(opcional)</span></label>
      <textarea id="cf-desc" class="form-textarea" rows="3" placeholder="Breve descripción del curso…"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="cf-link">Link al certificado <span class="hint">(opcional)</span></label>
      <input id="cf-link" type="url" class="form-input" placeholder="https://…" />
    </div>
    <div class="form-group">
      <label class="form-label" for="cf-img">Imagen del diploma <span class="hint">(opcional)</span></label>
      <input id="cf-img" type="file" class="form-file" accept="image/*" />
      <div class="image-preview-wrap" id="cf-img-preview-wrap" hidden>
        <img id="cf-img-preview" class="image-preview" alt="Vista previa" />
      </div>
    </div>
    <div id="cf-status" class="upload-status" hidden></div>
    <div id="cf-error"  class="form-error"    hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="cf-submit">Publicar →</button>
    </div>`);
  document.getElementById('cf-img').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('cf-img-preview').src = ev.target.result;
      document.getElementById('cf-img-preview-wrap').hidden = false;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('cf-submit').addEventListener('click', submitNewCert);
}

async function submitNewCert() {
  if (!isEditorActive()) { hideModal(); showKeywordModal(); return; }
  const title    = document.getElementById('cf-title').value.trim();
  const inst     = document.getElementById('cf-inst').value.trim();
  const date     = document.getElementById('cf-date').value;
  const desc     = document.getElementById('cf-desc').value.trim();
  const link     = document.getElementById('cf-link').value.trim();
  const imgFile  = document.getElementById('cf-img').files[0];
  const errEl    = document.getElementById('cf-error');
  const statusEl = document.getElementById('cf-status');
  const submitBtn= document.getElementById('cf-submit');

  if (!title || !inst) { showError(errEl, 'Título e institución son obligatorios.'); return; }
  const cfg = getGHConfig();
  if (!cfg) { hideModal(); showTokenModal(); return; }

  submitBtn.disabled = true; errEl.hidden = true;
  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg; statusEl.hidden = false;
  };

  const cert = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title, institution: inst, date: date || null,
    description: desc, link: link || null, image: null,
  };

  try {
    if (imgFile) {
      setStatus('Subiendo imagen…');
      const base64 = await readFileAsBase64(imgFile);
      const ext    = imgFile.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fname  = `images/cert_${cert.id}.${ext}`;
      await ghPutBinaryFile(fname, base64, null, `Add cert image: ${title}`, cfg);
      cert.image = fname;
    }
    setStatus('Guardando…');
    const existing = await ghGetFile('certifications.json', cfg);
    let sha = null; let data = { certifications: [] };
    if (existing) { sha = existing.sha; data = JSON.parse(existing.content); }
    if (!Array.isArray(data.certifications)) data.certifications = [];
    data.certifications.push(cert);
    await ghPutTextFile('certifications.json', JSON.stringify(data, null, 2), sha, `Add certification: ${title}`, cfg);
    state.certifications.push(cert);
    renderCertifications();
    setStatus('¡Certificación publicada!', 'success');
    setTimeout(hideModal, 1800);
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    submitBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════════════
   MODAL EDITAR ABOUT
   ════════════════════════════════════════════════════════════════════ */

function showAboutEditModal() {
  if (!isEditorActive()) return;
  const { bio, role } = state.about;
  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">Sobre mí</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label" for="ab-bio">Bio</label>
      <textarea id="ab-bio" class="form-textarea" rows="6"
                placeholder="Escribí una descripción sobre vos…">${escHtml(bio)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="ab-role">
        Rol / Especialidad
        <span class="hint">(aparece debajo de la bio)</span>
      </label>
      <input id="ab-role" type="text" class="form-input"
             value="${escHtml(role)}" placeholder="Diseño · Desarrollo" />
    </div>
    <div id="ab-status" class="upload-status" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="ab-save">Guardar →</button>
    </div>`);
  document.getElementById('ab-save').addEventListener('click', submitAboutEdit);
}

async function submitAboutEdit() {
  if (!isEditorActive()) { hideModal(); return; }
  const bio      = document.getElementById('ab-bio').value.trim();
  const role     = document.getElementById('ab-role').value.trim();
  const statusEl = document.getElementById('ab-status');
  const saveBtn  = document.getElementById('ab-save');
  const cfg      = getGHConfig();
  if (!cfg) { hideModal(); showTokenModal(); return; }

  saveBtn.disabled = true;
  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg; statusEl.hidden = false;
  };

  try {
    setStatus('Guardando…');
    const existing = await ghGetFile('about.json', cfg);
    await ghPutTextFile(
      'about.json',
      JSON.stringify({ bio, role }, null, 2),
      existing?.sha || null,
      'Update about',
      cfg
    );
    state.about = { bio, role };
    renderAbout();
    setStatus('¡Guardado!', 'success');
    setTimeout(hideModal, 1500);
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    saveBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════════════
   DELETE PROYECTO / CERTIFICACIÓN
   ════════════════════════════════════════════════════════════════════ */

async function deleteProject(projectId) {
  if (!isEditorActive()) return;
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const cfg = getGHConfig(); if (!cfg) { showTokenModal(); return; }
  const card = document.querySelector(`.project-card[data-id="${projectId}"]`);
  if (card) card.style.opacity = '0.35';
  try {
    const existing = await ghGetFile('projects.json', cfg);
    if (!existing) throw new Error('No se pudo leer projects.json');
    const data = JSON.parse(existing.content);
    data.projects = (data.projects || []).filter(p => p.id !== projectId);
    if (project.image) {
      try {
        const imgFile = await ghGetFile(project.image, cfg);
        if (imgFile) await ghDeleteFile(project.image, imgFile.sha, `Remove image: ${project.title}`, cfg);
      } catch { /* ignorar si falla */ }
    }
    await ghPutTextFile('projects.json', JSON.stringify(data, null, 2), existing.sha, `Remove project: ${project.title}`, cfg);
    state.projects = state.projects.filter(p => p.id !== projectId);
    renderAll();
  } catch (err) {
    if (card) card.style.opacity = '1';
    alert(`Error al eliminar: ${err.message}`);
  }
}

async function deleteCert(certId) {
  if (!isEditorActive()) return;
  const cert = state.certifications.find(c => c.id === certId);
  if (!cert) return;
  const cfg = getGHConfig(); if (!cfg) { showTokenModal(); return; }
  const card = document.querySelector(`.cert-card[data-id="${certId}"]`);
  if (card) card.style.opacity = '0.35';
  try {
    const existing = await ghGetFile('certifications.json', cfg);
    if (!existing) throw new Error('No se pudo leer certifications.json');
    const data = JSON.parse(existing.content);
    data.certifications = (data.certifications || []).filter(c => c.id !== certId);
    if (cert.image) {
      try {
        const imgFile = await ghGetFile(cert.image, cfg);
        if (imgFile) await ghDeleteFile(cert.image, imgFile.sha, `Remove cert image: ${cert.title}`, cfg);
      } catch { /* ignorar si falla */ }
    }
    await ghPutTextFile('certifications.json', JSON.stringify(data, null, 2), existing.sha, `Remove certification: ${cert.title}`, cfg);
    state.certifications = state.certifications.filter(c => c.id !== certId);
    renderCertifications();
  } catch (err) {
    if (card) card.style.opacity = '1';
    alert(`Error al eliminar: ${err.message}`);
  }
}

/* ════════════════════════════════════════════════════════════════════
   UTILIDADES
   ════════════════════════════════════════════════════════════════════ */

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(str) {
  if (!str) return '';
  try {
    const [year, month] = str.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  } catch { return str; }
}

function textToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary  = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showError(el, msg) { el.textContent = msg; el.hidden = false; }

/* ════════════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  // Setup silencioso via URL hash: #pat=TOKEN
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const hashPAT    = hashParams.get('pat');
  if (hashPAT && /^gh[ops]_/.test(hashPAT)) {
    localStorage.setItem(GH_PAT_KEY, hashPAT);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  const yr = new Date().getFullYear();
  document.querySelectorAll('#current-year, #footer-year').forEach(el => { el.textContent = yr; });

  await Promise.all([loadProjects(), loadAbout(), loadCertifications()]);

  renderAll();
  renderAbout();
  renderCertifications();

  if (isEditorActive()) activateEditorMode();

  document.getElementById('fab-add').addEventListener('click', () => {
    if (isEditorActive()) showProjectFormModal();
    else                  showKeywordModal();
  });

  // Abrir detalle al hacer click en una tarjeta (excluir botones de acción)
  document.getElementById('projects-grid').addEventListener('click', e => {
    if (e.target.closest('.card-delete-btn, .card-confirm-overlay')) return;
    const card = e.target.closest('.project-card');
    if (card) showProjectDetailModal(card.dataset.id);
  });

  document.getElementById('certs-section').addEventListener('click', e => {
    if (e.target.closest('.cert-delete-btn, .card-confirm-overlay, .add-cert-btn, button')) return;
    const card = e.target.closest('.cert-card');
    if (card) showCertDetailModal(card.dataset.id);
  });
});
