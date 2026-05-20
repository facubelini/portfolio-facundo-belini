/* ================================================================
   PORTFOLIO — app.js

   Modelo de seguridad:
   ─ Palabra clave  → verificada por sesión (sessionStorage)
   ─ GH config      → localStorage (PAT, owner, repo, branch)
   ─ DOM de edición → inyectado SOLO después de verificación
   ─ Write API      → doble-check isEditorActive() antes de cada fetch

   La palabra clave evita acciones accidentales (UI gate).
   El PAT es la protección real de los datos del repositorio.
   ================================================================ */

'use strict';

/* ─── Constantes ─────────────────────────────────────────────────── */
const KEYWORD        = 'Blogdelporta1!';
const MAX_ATTEMPTS   = 5;
const LOCKOUT_MS     = 5 * 60 * 1000;   // 5 minutos
const GH_CONFIG_KEY  = 'pflio_gh_config';
const EDITOR_SES_KEY = 'pflio_editor_active';
const GH_API         = 'https://api.github.com';

/* ─── Estado en memoria (se resetea con cada carga de página) ────── */
const state = {
  projects:       [],
  activeFilter:   'Todos',
  failedAttempts: 0,
  lockoutUntil:   null,
};

/* ════════════════════════════════════════════════════════════════════
   SESIÓN DE EDITOR
   ════════════════════════════════════════════════════════════════════ */

const isEditorActive  = () => sessionStorage.getItem(EDITOR_SES_KEY) === 'true';
const activateSession = () => sessionStorage.setItem(EDITOR_SES_KEY, 'true');
const clearSession    = () => sessionStorage.removeItem(EDITOR_SES_KEY);

function getGHConfig() {
  try { return JSON.parse(localStorage.getItem(GH_CONFIG_KEY)); }
  catch { return null; }
}
function saveGHConfig(cfg) {
  localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(cfg));
}

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

/** GET un archivo del repo. Devuelve { sha, content } o null si no existe. */
async function ghGetFile(path, cfg) {
  const url = `${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${cfg.branch}`;
  const res = await fetch(url, { headers: ghHeaders(cfg.pat) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return {
    sha:     data.sha,
    content: atob(data.content.replace(/\n/g, '')),
  };
}

/** PUT un archivo de texto (UTF-8 → base64). */
async function ghPutTextFile(path, text, sha, msg, cfg) {
  if (!isEditorActive()) throw new Error('Sesión de editor inactiva — operación cancelada.');
  const content = textToBase64(text);
  const body    = { message: msg, content, branch: cfg.branch };
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

/** PUT un archivo binario (base64 directo desde FileReader). */
async function ghPutBinaryFile(path, base64, sha, msg, cfg) {
  if (!isEditorActive()) throw new Error('Sesión de editor inactiva — operación cancelada.');
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

/** DELETE un archivo del repo. */
async function ghDeleteFile(path, sha, msg, cfg) {
  if (!isEditorActive()) throw new Error('Sesión de editor inactiva — operación cancelada.');
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
   CARGAR Y RENDERIZAR PROYECTOS
   ════════════════════════════════════════════════════════════════════ */

async function loadProjects() {
  try {
    const res = await fetch(`./projects.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.projects = data.projects || [];
  } catch {
    state.projects = [];
  }
}

function renderAll() {
  renderCategories();
  renderProjects(state.activeFilter);
  updateCounter();
}

function renderCategories() {
  const container  = document.getElementById('filters-container');
  const categories = ['Todos', ...new Set(
    state.projects.map(p => p.category).filter(Boolean)
  )];
  container.innerHTML = categories.map(cat => `
    <button class="filter-btn${cat === state.activeFilter ? ' active' : ''}" data-cat="${escHtml(cat)}">
      ${escHtml(cat)}
    </button>
  `).join('');
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeFilter = btn.dataset.cat;
      container.querySelectorAll('.filter-btn').forEach(b =>
        b.classList.toggle('active', b === btn)
      );
      renderProjects(state.activeFilter);
    });
  });
}

function renderProjects(filter) {
  const grid  = document.getElementById('projects-grid');
  const empty = document.getElementById('empty-state');
  const list  = filter === 'Todos'
    ? state.projects
    : state.projects.filter(p => p.category === filter);

  if (list.length === 0) {
    grid.innerHTML = '';
    empty.hidden   = false;
    return;
  }
  empty.hidden   = true;
  grid.innerHTML = list.map((p, i) => buildCardHTML(p, i)).join('');

  if (isEditorActive()) attachDeleteHandlers();
}

function buildCardHTML(project, idx) {
  const id  = escHtml(project.id || '');
  const img = project.image
    ? `<div class="card-img-wrap">
         <img src="./${escHtml(project.image)}" alt="${escHtml(project.title)}" class="card-img" loading="lazy" />
       </div>`
    : `<div class="card-img-wrap card-img-placeholder">
         <span class="placeholder-label" aria-hidden="true">${escHtml(project.category || '—')}</span>
       </div>`;

  const tags = (project.technologies || [])
    .map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('');

  const delBtn = isEditorActive()
    ? `<button class="card-delete-btn" data-id="${id}" aria-label="Eliminar ${escHtml(project.title)}" title="Eliminar">×</button>`
    : '';

  return `
    <article class="project-card" data-id="${id}" style="--card-i:${idx}">
      ${delBtn}
      ${img}
      <div class="card-body">
        <span class="card-category">${escHtml(project.category || '')}</span>
        <h2 class="card-title">${escHtml(project.title)}</h2>
        ${project.date ? `<time class="card-date" datetime="${escHtml(project.date)}">${formatDate(project.date)}</time>` : ''}
        <p class="card-desc">${escHtml(project.description || '')}</p>
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      </div>
    </article>
  `.trim();
}

function attachDeleteHandlers() {
  document.querySelectorAll('.card-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const card = btn.closest('.project-card');
      showDeleteConfirm(btn.dataset.id, card);
    });
  });
}

function showDeleteConfirm(projectId, cardEl) {
  // Quitar overlay previo si existe
  cardEl.querySelector('.card-confirm-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-confirm-overlay';
  overlay.innerHTML = `
    <p class="confirm-msg">¿Eliminar este proyecto?</p>
    <div class="confirm-btns">
      <button class="btn btn-danger confirm-yes">Sí, eliminar</button>
      <button class="btn btn-ghost confirm-no">Cancelar</button>
    </div>
  `;
  cardEl.appendChild(overlay);
  overlay.querySelector('.confirm-no').addEventListener('click',  () => overlay.remove());
  overlay.querySelector('.confirm-yes').addEventListener('click', () => {
    overlay.remove();
    deleteProject(projectId);
  });
}

function updateCounter() {
  const el = document.getElementById('project-count');
  if (el) el.textContent = state.projects.length;
}

/* ════════════════════════════════════════════════════════════════════
   SISTEMA DE MODAL
   ════════════════════════════════════════════════════════════════════ */

function showModal(html) {
  const overlay = document.getElementById('modal-overlay');
  const box     = document.getElementById('modal-box');
  box.innerHTML  = html;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.onclick = e => { if (e.target === overlay) hideModal(); };
  // Foco en primer input si existe
  setTimeout(() => box.querySelector('input, textarea')?.focus(), 60);
}

function hideModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.onclick = null;
  setTimeout(() => { document.getElementById('modal-box').innerHTML = ''; }, 220);
}

function setModalContent(html) {
  document.getElementById('modal-box').innerHTML = html;
}

/* ════════════════════════════════════════════════════════════════════
   GATE DE PALABRA CLAVE — sin shortcuts, sin excepciones
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
      <p class="modal-msg modal-msg--error">
        Demasiados intentos fallidos.<br>
        Intentá de nuevo en ${mins} minuto${mins !== 1 ? 's' : ''}.
      </p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="hideModal()">Cerrar</button>
      </div>
    `);
    return;
  }

  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">Modo editor</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <p class="modal-sub">Ingresá la palabra clave para activar el modo editor.</p>
    <div class="form-group">
      <label class="form-label" for="kw-input">Palabra clave</label>
      <input id="kw-input" type="password" class="form-input"
             autocomplete="off" autocorrect="off" autocapitalize="off"
             placeholder="••••••••••••" />
    </div>
    <div id="kw-error" class="form-error" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="kw-btn">Continuar →</button>
    </div>
  `);

  const input  = document.getElementById('kw-input');
  const errEl  = document.getElementById('kw-error');
  const btn    = document.getElementById('kw-btn');

  const submit = () => {
    const val = input.value;   // Sin trim — la clave se compara exacta
    if (!val) { showError(errEl, 'Ingresá la palabra clave.'); return; }
    handleKeywordSubmit(val, errEl, btn, input);
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function handleKeywordSubmit(value, errEl, btn, input) {
  if (value === KEYWORD) {
    // ✓ Correcto
    state.failedAttempts = 0;
    activateSession();
    activateEditorMode();
    hideModal();
    const cfg = getGHConfig();
    setTimeout(() => {
      if (!cfg) showSetupModal();
      else showProjectFormModal();
    }, 260);
    return;
  }

  // ✗ Incorrecto
  state.failedAttempts++;
  if (state.failedAttempts >= MAX_ATTEMPTS) {
    state.lockoutUntil = Date.now() + LOCKOUT_MS;
    showError(errEl, `Acceso bloqueado por ${LOCKOUT_MS / 60000} minutos.`);
    btn.disabled = true;
    return;
  }

  const left = MAX_ATTEMPTS - state.failedAttempts;
  showError(errEl, `Palabra clave incorrecta. ${left} intento${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''}.`);
  if (input) { input.value = ''; input.focus(); }
}

/* ════════════════════════════════════════════════════════════════════
   ACTIVAR / DESACTIVAR MODO EDITOR
   ════════════════════════════════════════════════════════════════════ */

function activateEditorMode() {
  if (document.getElementById('editor-indicator')) return;
  const header = document.querySelector('.site-header');
  const ind    = document.createElement('div');
  ind.id        = 'editor-indicator';
  ind.className = 'editor-indicator';
  ind.innerHTML = `
    <span class="editor-dot" aria-hidden="true"></span>
    <span class="editor-label">Modo editor</span>
    <button class="editor-exit-btn" id="editor-exit-btn">Salir</button>
  `;
  // Insertar en header-right si existe, sino al final del header
  const right = header.querySelector('.header-right');
  if (right) right.prepend(ind);
  else header.appendChild(ind);
  document.getElementById('editor-exit-btn').addEventListener('click', deactivateEditorMode);
  // Re-renderizar con botones de borrar
  renderProjects(state.activeFilter);
}

function deactivateEditorMode() {
  clearSession();
  document.getElementById('editor-indicator')?.remove();
  renderProjects(state.activeFilter);
}

/* ════════════════════════════════════════════════════════════════════
   MODAL DE CONFIGURACIÓN DE GITHUB
   ════════════════════════════════════════════════════════════════════ */

function showSetupModal() {
  const cfg = getGHConfig() || { owner: '', repo: '', pat: '', branch: 'main' };
  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">Configurar GitHub</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <p class="modal-sub">
      Estos datos se guardan solo en tu navegador (localStorage).<br>
      No se envían a ningún servidor externo.
    </p>
    <div class="form-group">
      <label class="form-label" for="s-owner">Usuario de GitHub <span class="req">*</span></label>
      <input id="s-owner" type="text" class="form-input" value="${escHtml(cfg.owner)}"
             placeholder="tu-usuario" autocomplete="off" spellcheck="false" />
    </div>
    <div class="form-group">
      <label class="form-label" for="s-repo">Nombre del repositorio <span class="req">*</span></label>
      <input id="s-repo" type="text" class="form-input" value="${escHtml(cfg.repo)}"
             placeholder="mi-portfolio" autocomplete="off" spellcheck="false" />
    </div>
    <div class="form-group">
      <label class="form-label" for="s-pat">Personal Access Token <span class="req">*</span></label>
      <input id="s-pat" type="password" class="form-input" value="${escHtml(cfg.pat)}"
             placeholder="github_pat_..." autocomplete="off" />
    </div>
    <div class="form-group">
      <label class="form-label" for="s-branch">Branch</label>
      <input id="s-branch" type="text" class="form-input" value="${escHtml(cfg.branch)}"
             placeholder="main" autocomplete="off" />
    </div>
    <div id="s-error" class="form-error" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="s-save-btn">Guardar y continuar →</button>
    </div>
  `);

  document.getElementById('s-save-btn').addEventListener('click', () => {
    const owner  = document.getElementById('s-owner').value.trim();
    const repo   = document.getElementById('s-repo').value.trim();
    const pat    = document.getElementById('s-pat').value.trim();
    const branch = document.getElementById('s-branch').value.trim() || 'main';
    const errEl  = document.getElementById('s-error');
    if (!owner || !repo || !pat) {
      showError(errEl, 'Usuario, repositorio y token son obligatorios.'); return;
    }
    saveGHConfig({ owner, repo, pat, branch });
    hideModal();
    setTimeout(() => showProjectFormModal(), 260);
  });
}

/* ════════════════════════════════════════════════════════════════════
   MODAL DE NUEVO PROYECTO
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
      <textarea id="pf-desc" class="form-textarea" placeholder="Descripción breve del proyecto…"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-tech">
        Tecnologías / medios
        <span class="hint">(separados por coma)</span>
      </label>
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
    <div id="pf-error" class="form-error" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="pf-submit">Publicar →</button>
    </div>
  `);

  document.getElementById('pf-img').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img  = document.getElementById('img-preview');
      const wrap = document.getElementById('img-preview-wrap');
      img.src    = ev.target.result;
      wrap.hidden = false;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('pf-submit').addEventListener('click', submitNewProject);
}

async function submitNewProject() {
  // Doble-check de sesión antes de cualquier escritura
  if (!isEditorActive()) { hideModal(); showKeywordModal(); return; }

  const title    = document.getElementById('pf-title').value.trim();
  const category = document.getElementById('pf-cat').value.trim();
  const date     = document.getElementById('pf-date').value;
  const desc     = document.getElementById('pf-desc').value.trim();
  const tech     = document.getElementById('pf-tech').value.trim();
  const imgFile  = document.getElementById('pf-img').files[0];
  const errEl    = document.getElementById('pf-error');
  const statusEl = document.getElementById('pf-status');
  const submitBtn = document.getElementById('pf-submit');

  if (!title || !category) {
    showError(errEl, 'Título y categoría son obligatorios.'); return;
  }
  const cfg = getGHConfig();
  if (!cfg) { hideModal(); showSetupModal(); return; }

  submitBtn.disabled = true;
  errEl.hidden = true;

  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg;
    statusEl.hidden = false;
  };

  const project = {
    id:           Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    category,
    date:         date || null,
    description:  desc,
    technologies: tech ? tech.split(',').map(t => t.trim()).filter(Boolean) : [],
    image:        null,
  };

  try {
    // 1. Subir imagen si hay
    if (imgFile) {
      setStatus('Subiendo imagen…');
      const base64 = await readFileAsBase64(imgFile);
      const ext    = imgFile.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fname  = `images/${project.id}.${ext}`;
      await ghPutBinaryFile(fname, base64, null, `Add image: ${title}`, cfg);
      project.image = fname;
    }

    // 2. Leer projects.json actual (para obtener SHA)
    setStatus('Guardando proyecto…');
    const existing = await ghGetFile('projects.json', cfg);
    let sha = null;
    let data = { projects: [] };
    if (existing) {
      sha  = existing.sha;
      data = JSON.parse(existing.content);
    }
    if (!Array.isArray(data.projects)) data.projects = [];

    // 3. Agregar y escribir
    data.projects.push(project);
    await ghPutTextFile(
      'projects.json',
      JSON.stringify(data, null, 2),
      sha,
      `Add project: ${title}`,
      cfg
    );

    // 4. Actualizar estado local y re-renderizar
    state.projects.push(project);
    renderAll();

    setStatus('¡Proyecto publicado correctamente!', 'success');
    setTimeout(hideModal, 2000);

  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    submitBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════════════
   ELIMINAR PROYECTO
   ════════════════════════════════════════════════════════════════════ */

async function deleteProject(projectId) {
  // Doble-check de sesión
  if (!isEditorActive()) return;

  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  const cfg = getGHConfig();
  if (!cfg) { showSetupModal(); return; }

  const card = document.querySelector(`.project-card[data-id="${projectId}"]`);
  if (card) card.style.opacity = '0.35';

  try {
    // 1. Leer projects.json
    const existing = await ghGetFile('projects.json', cfg);
    if (!existing) throw new Error('No se pudo leer projects.json del repositorio.');
    const data = JSON.parse(existing.content);
    data.projects = (data.projects || []).filter(p => p.id !== projectId);

    // 2. Intentar borrar imagen si existe
    if (project.image) {
      try {
        const imgFile = await ghGetFile(project.image, cfg);
        if (imgFile) {
          await ghDeleteFile(project.image, imgFile.sha, `Remove image: ${project.title}`, cfg);
        }
      } catch { /* no detener el flujo si falla el borrado de imagen */ }
    }

    // 3. Actualizar projects.json
    await ghPutTextFile(
      'projects.json',
      JSON.stringify(data, null, 2),
      existing.sha,
      `Remove project: ${project.title}`,
      cfg
    );

    // 4. Actualizar estado local
    state.projects = state.projects.filter(p => p.id !== projectId);
    renderAll();

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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(str) {
  if (!str) return '';
  try {
    const [year, month] = str.split('-').map(Number);
    return new Date(year, month - 1, 1)
      .toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  } catch { return str; }
}

/** Convierte string UTF-8 a base64 de forma segura (soporta caracteres no-ASCII). */
function textToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary  = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Lee un File y devuelve el contenido base64 (sin el prefijo data:...;base64,). */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

/* ════════════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  // Año actual en header y footer
  const yr = new Date().getFullYear();
  document.querySelectorAll('#current-year, #footer-year')
    .forEach(el => { el.textContent = yr; });

  // Cargar y renderizar proyectos
  await loadProjects();
  renderAll();

  // Restaurar modo editor si la sesión sigue activa
  if (isEditorActive()) activateEditorMode();

  // FAB — SIEMPRE pasa por el gate de palabra clave
  document.getElementById('fab-add').addEventListener('click', () => {
    if (isEditorActive()) {
      showProjectFormModal();
    } else {
      showKeywordModal();
    }
  });
});
