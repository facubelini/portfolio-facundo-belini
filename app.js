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
  contact:        { linkedin: '', whatsapp: '', email: '' },
  hero:           { line1: 'Trabajo', line2: 'seleccionado.', sub: 'Diseño y desarrollo.' },
  activeFilter:   'Todos',
  failedAttempts: 0,
  lockoutUntil:   null,
};

/* ─── Carousel state ─────────────────────────────────────────────── */
let _carouselIdx  = 0;
let _carouselImgs = [];

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

function ghReadHeaders(pat) {
  return {
    'Authorization': `token ${pat}`,
    'Accept':        'application/vnd.github.v3+json',
  };
}

async function ghGetFile(path, cfg) {
  const url = `${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${cfg.branch}&_=${Date.now()}`;
  const res = await fetch(url, { headers: ghReadHeaders(cfg.pat) });
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
   HELPERS
   ════════════════════════════════════════════════════════════════════ */

/** Normaliza campo image/images para backward compat. Siempre retorna array. */
function getImages(item) {
  if (Array.isArray(item.images) && item.images.length > 0) return item.images;
  if (item.image) return [item.image];
  return [];
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

async function loadContact() {
  try {
    const res = await fetch(`./contact.json?t=${Date.now()}`);
    if (!res.ok) throw new Error();
    const d = await res.json();
    state.contact = {
      linkedin: d.linkedin || '',
      whatsapp: d.whatsapp || '',
      email:    d.email    || '',
    };
  } catch { state.contact = { linkedin: '', whatsapp: '', email: '' }; }
}

async function loadHero() {
  try {
    const res = await fetch(`./hero.json?t=${Date.now()}`);
    if (!res.ok) throw new Error();
    const d = await res.json();
    state.hero = {
      line1: d.line1 || 'Trabajo',
      line2: d.line2 || 'seleccionado.',
      sub:   d.sub   || 'Diseño y desarrollo.',
    };
  } catch { state.hero = { line1: 'Trabajo', line2: 'seleccionado.', sub: 'Diseño y desarrollo.' }; }
}

/* ════════════════════════════════════════════════════════════════════
   RENDER — HERO
   ════════════════════════════════════════════════════════════════════ */

function renderHero() {
  const l1 = document.getElementById('hero-line1');
  const l2 = document.getElementById('hero-line2');
  const sb = document.getElementById('hero-sub');
  if (l1) l1.textContent = state.hero.line1;
  if (l2) l2.textContent = state.hero.line2;
  if (sb) sb.textContent = state.hero.sub;

  const section = document.getElementById('hero-section');
  section?.querySelector('.hero-edit-btn')?.remove();
  if (isEditorActive() && section) {
    const btn = document.createElement('button');
    btn.className = 'hero-edit-btn';
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Editar intro`;
    btn.addEventListener('click', showHeroEditModal);
    section.querySelector('.hero-text')?.appendChild(btn);
  }
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
  if (isEditorActive()) attachCardEditorHandlers();
}

function buildCardHTML(project, idx) {
  const id     = escHtml(project.id || '');
  const images = getImages(project);
  const img    = images.length > 0
    ? `<div class="card-img-wrap">
         ${images.length > 1 ? `<span class="card-img-count">${images.length} imgs</span>` : ''}
         <img src="./${escHtml(images[0])}" alt="${escHtml(project.title)}" class="card-img" loading="lazy" />
       </div>`
    : `<div class="card-img-wrap card-img-placeholder"><span class="placeholder-label" aria-hidden="true">${escHtml(project.category || '—')}</span></div>`;
  const tags    = (project.technologies || []).map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('');
  const delBtn  = isEditorActive()
    ? `<button class="card-delete-btn" data-id="${id}" aria-label="Eliminar" title="Eliminar">×</button>` : '';
  const editBtn = isEditorActive()
    ? `<button class="card-edit-btn" data-id="${id}" aria-label="Editar" title="Editar">
         <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
           <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
         </svg>
       </button>` : '';

  return `
    <article class="project-card" data-id="${id}" style="--card-i:${idx}">
      ${editBtn}${delBtn}${img}
      <div class="card-body">
        <span class="card-category">${escHtml(project.category || '')}</span>
        <h2 class="card-title">${escHtml(project.title)}</h2>
        ${project.date ? `<time class="card-date" datetime="${escHtml(project.date)}">${formatDate(project.date)}</time>` : ''}
        <p class="card-desc">${escHtml(project.description || '')}</p>
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      </div>
    </article>`.trim();
}

function attachCardEditorHandlers() {
  document.querySelectorAll('.card-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showDeleteConfirm(btn.dataset.id, btn.closest('.project-card'));
    });
  });
  document.querySelectorAll('.card-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showProjectEditModal(btn.dataset.id);
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

  document.getElementById('add-cert-btn')?.addEventListener('click', () => showCertFormModal(null));

  if (isEditorActive()) {
    section.querySelectorAll('.cert-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showCertDeleteConfirm(btn.dataset.id, btn.closest('.cert-card'));
      });
    });
    section.querySelectorAll('.cert-edit-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showCertEditModal(btn.dataset.id);
      });
    });
  }
}

function buildCertCardHTML(cert, idx) {
  const id      = escHtml(cert.id || '');
  const images  = getImages(cert);
  const delBtn  = isEditorActive()
    ? `<button class="cert-delete-btn" data-id="${id}" aria-label="Eliminar" title="Eliminar">×</button>` : '';
  const editBtn = isEditorActive()
    ? `<button class="cert-edit-btn" data-id="${id}" aria-label="Editar" title="Editar">
         <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
           <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
         </svg>
       </button>` : '';
  const imgEl = images.length > 0
    ? `<div class="cert-img-wrap">
         ${images.length > 1 ? `<span class="card-img-count">${images.length} imgs</span>` : ''}
         <img src="./${escHtml(images[0])}" alt="${escHtml(cert.title)}" class="cert-img" loading="lazy" />
       </div>` : '';
  const linkEl = cert.link
    ? `<a class="cert-link" href="${escHtml(cert.link)}" target="_blank" rel="noopener noreferrer">Ver certificado</a>` : '';

  return `
    <div class="cert-card" data-id="${id}" style="--card-i:${idx}">
      ${editBtn}${delBtn}
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
   RENDER — CONTACTO (en el header)
   ════════════════════════════════════════════════════════════════════ */

const CONTACT_ICONS = {
  linkedin: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
  whatsapp: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>`,
  email:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 7 10-7"/></svg>`,
};

const CONTACT_LABELS = {
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  email:    'Email',
};

function getContactHref(type, value) {
  if (type === 'email')    return `mailto:${value}`;
  if (type === 'whatsapp') return `https://wa.me/${value.replace(/\D/g, '')}`;
  return value; // linkedin: full URL
}

function renderContactHeader() {
  const wrap = document.getElementById('contact-header-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const { linkedin, whatsapp, email } = state.contact;
  const keys = ['linkedin', 'whatsapp', 'email'].filter(k => state.contact[k]);

  if (keys.length === 0 && !isEditorActive()) return;

  const nav = document.createElement('div');
  nav.className = 'contact-header-links';

  keys.forEach(k => {
    nav.insertAdjacentHTML('beforeend', `
      <a class="contact-header-link contact-header-link--${k}"
         href="${escHtml(getContactHref(k, state.contact[k]))}"
         target="${k === 'email' ? '_self' : '_blank'}"
         rel="noopener noreferrer"
         title="${CONTACT_LABELS[k]}"
         aria-label="${CONTACT_LABELS[k]}">
        ${CONTACT_ICONS[k]}
      </a>`);
  });

  if (isEditorActive()) {
    const btn = document.createElement('button');
    if (keys.length === 0) {
      // Sin datos: botón de texto visible
      btn.className = 'contact-header-add-btn';
      btn.textContent = '+ Contacto';
    } else {
      // Con datos: lápiz pequeño junto a los íconos
      btn.className = 'contact-header-edit-btn';
      btn.title = 'Editar contacto';
      btn.setAttribute('aria-label', 'Editar contacto');
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    btn.addEventListener('click', showContactEditModal);
    nav.appendChild(btn);
  }

  wrap.appendChild(nav);
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
   CAROUSEL
   ════════════════════════════════════════════════════════════════════ */

function buildCarouselHTML(images, altText) {
  if (images.length === 0) return '';
  if (images.length === 1) {
    return `
      <div class="detail-img-wrap">
        <img src="./${escHtml(images[0])}" class="detail-img" alt="${escHtml(altText)}" loading="lazy" />
      </div>`;
  }
  const dots = images.map((_, i) =>
    `<button class="carousel-dot${i === 0 ? ' active' : ''}" data-idx="${i}" aria-label="Imagen ${i + 1}"></button>`
  ).join('');
  return `
    <div class="detail-carousel" id="detail-carousel">
      <img src="./${escHtml(images[0])}" class="detail-carousel-img" id="carousel-main-img" alt="${escHtml(altText)}" loading="lazy" />
      <button class="carousel-arrow carousel-arrow--prev" onclick="carouselNav(-1)" aria-label="Anterior">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><polyline points="11,3 5,9 11,15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="carousel-arrow carousel-arrow--next" onclick="carouselNav(1)" aria-label="Siguiente">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><polyline points="7,3 13,9 7,15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="carousel-dots">${dots}</div>
    </div>`;
}

function carouselNav(dir) {
  if (_carouselImgs.length < 2) return;
  _carouselIdx = (_carouselIdx + dir + _carouselImgs.length) % _carouselImgs.length;
  updateCarousel();
}

function updateCarousel() {
  const img  = document.getElementById('carousel-main-img');
  const dots = document.querySelectorAll('.carousel-dot');
  if (img) img.src = `./${_carouselImgs[_carouselIdx]}`;
  dots.forEach((d, i) => d.classList.toggle('active', i === _carouselIdx));
}

function bindCarouselDots() {
  document.querySelectorAll('.carousel-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      _carouselIdx = parseInt(dot.dataset.idx, 10);
      updateCarousel();
    });
  });
}

/* ════════════════════════════════════════════════════════════════════
   DETAIL MODALS — VER EN DETALLE
   ════════════════════════════════════════════════════════════════════ */

function showProjectDetailModal(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const images  = getImages(project);
  _carouselImgs = images;
  _carouselIdx  = 0;
  const imgHTML = buildCarouselHTML(images, project.title);
  const tags    = (project.technologies || []).map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('');

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

  if (images.length > 1) bindCarouselDots();
}

function showCertDetailModal(certId) {
  const cert   = state.certifications.find(c => c.id === certId);
  if (!cert) return;
  const images  = getImages(cert);
  _carouselImgs = images;
  _carouselIdx  = 0;
  const imgHTML = buildCarouselHTML(images, cert.title);
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

  if (images.length > 1) bindCarouselDots();
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
      else showProjectFormModal(null);
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
    setTimeout(() => showProjectFormModal(null), 260);
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
  renderHero();
  renderProjects(state.activeFilter);
  renderAbout();
  renderCertifications();
  renderContactHeader();
}

function deactivateEditorMode() {
  clearSession();
  document.getElementById('editor-indicator')?.remove();
  renderHero();
  renderProjects(state.activeFilter);
  renderAbout();
  renderCertifications();
  renderContactHeader();
}

/* ════════════════════════════════════════════════════════════════════
   MODAL PROYECTO (nuevo o editar — formulario unificado)
   ════════════════════════════════════════════════════════════════════ */

function showProjectFormModal(existingProject) {
  if (!isEditorActive()) { showKeywordModal(); return; }
  const isEdit = !!existingProject;
  const p      = existingProject || {};
  const existingImages = getImages(p);

  const existingImgsHTML = isEdit && existingImages.length > 0
    ? `<div class="form-group">
         <label class="form-label">Imágenes actuales <span class="hint">(× para quitar)</span></label>
         <div class="current-imgs" id="pf-current-imgs">
           ${existingImages.map((img, i) => `
             <div class="current-img-item" data-img="${escHtml(img)}">
               <img src="./${escHtml(img)}" class="current-img-thumb" alt="Imagen ${i + 1}" />
               <button type="button" class="current-img-remove" aria-label="Quitar imagen">×</button>
             </div>`).join('')}
         </div>
       </div>` : '';

  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">${isEdit ? 'Editar proyecto' : 'Nuevo proyecto'}</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-title">Título <span class="req">*</span></label>
      <input id="pf-title" type="text" class="form-input" placeholder="Mi proyecto" value="${escHtml(p.title || '')}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="pf-cat">Categoría <span class="req">*</span></label>
        <input id="pf-cat" type="text" class="form-input" placeholder="Diseño" value="${escHtml(p.category || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="pf-date">Fecha</label>
        <input id="pf-date" type="month" class="form-input" value="${escHtml(p.date || '')}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-desc">Descripción</label>
      <textarea id="pf-desc" class="form-textarea" placeholder="Descripción breve…">${escHtml(p.description || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-tech">Tecnologías / medios <span class="hint">(separadas por coma)</span></label>
      <input id="pf-tech" type="text" class="form-input" placeholder="HTML, CSS, Figma" value="${escHtml((p.technologies || []).join(', '))}" />
    </div>
    ${existingImgsHTML}
    <div class="form-group">
      <label class="form-label" for="pf-imgs">${isEdit ? 'Agregar imágenes' : 'Imágenes'} <span class="hint">(podés elegir varias)</span></label>
      <input id="pf-imgs" type="file" class="form-file" accept="image/*" multiple />
      <div class="new-imgs-preview" id="pf-new-previews"></div>
    </div>
    <div id="pf-status" class="upload-status" hidden></div>
    <div id="pf-error"  class="form-error"    hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="pf-submit">${isEdit ? 'Guardar cambios →' : 'Publicar →'}</button>
    </div>`);

  // Quitar imágenes existentes
  document.querySelectorAll('.current-img-remove').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.current-img-item').remove());
  });

  // Preview imágenes nuevas
  document.getElementById('pf-imgs').addEventListener('change', e => {
    const wrap = document.getElementById('pf-new-previews');
    wrap.innerHTML = '';
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const div = document.createElement('div');
        div.className = 'new-img-preview-item';
        div.innerHTML = `<img src="${ev.target.result}" class="new-img-thumb" alt="${escHtml(file.name)}" />`;
        wrap.appendChild(div);
      };
      reader.readAsDataURL(file);
    });
  });

  document.getElementById('pf-submit').addEventListener('click', () => {
    if (isEdit) submitProjectEdit(p.id, existingImages);
    else        submitNewProject();
  });
}

function showProjectEditModal(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  showProjectFormModal(project);
}

async function submitNewProject() {
  if (!isEditorActive()) { hideModal(); showKeywordModal(); return; }
  const title    = document.getElementById('pf-title').value.trim();
  const category = document.getElementById('pf-cat').value.trim();
  const date     = document.getElementById('pf-date').value;
  const desc     = document.getElementById('pf-desc').value.trim();
  const tech     = document.getElementById('pf-tech').value.trim();
  const imgFiles = Array.from(document.getElementById('pf-imgs').files);
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
    images: [],
  };

  try {
    for (let i = 0; i < imgFiles.length; i++) {
      setStatus(`Subiendo imágenes (${i + 1}/${imgFiles.length})…`);
      const file   = imgFiles[i];
      const base64 = await readFileAsBase64(file);
      const ext    = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fname  = `images/${project.id}_${i}.${ext}`;
      await ghPutBinaryFile(fname, base64, null, `Add image: ${title}`, cfg);
      project.images.push(fname);
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

async function submitProjectEdit(projectId, originalImages) {
  if (!isEditorActive()) { hideModal(); showKeywordModal(); return; }
  const title    = document.getElementById('pf-title').value.trim();
  const category = document.getElementById('pf-cat').value.trim();
  const date     = document.getElementById('pf-date').value;
  const desc     = document.getElementById('pf-desc').value.trim();
  const tech     = document.getElementById('pf-tech').value.trim();
  const imgFiles = Array.from(document.getElementById('pf-imgs').files);
  const errEl    = document.getElementById('pf-error');
  const statusEl = document.getElementById('pf-status');
  const submitBtn= document.getElementById('pf-submit');

  if (!title || !category) { showError(errEl, 'Título y categoría son obligatorios.'); return; }
  const cfg = getGHConfig();
  if (!cfg) { hideModal(); showTokenModal(); return; }

  // Imágenes que siguen en el DOM (no fueron quitadas)
  const keptImages = Array.from(document.querySelectorAll('#pf-current-imgs .current-img-item'))
    .map(el => el.dataset.img).filter(Boolean);

  submitBtn.disabled = true; errEl.hidden = true;
  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg; statusEl.hidden = false;
  };

  try {
    // Borrar imágenes quitadas de GitHub
    const removedImages = originalImages.filter(img => !keptImages.includes(img));
    for (const imgPath of removedImages) {
      try {
        const f = await ghGetFile(imgPath, cfg);
        if (f) await ghDeleteFile(imgPath, f.sha, `Remove image: ${title}`, cfg);
      } catch { /* continuar si ya no existe */ }
    }

    // Subir imágenes nuevas
    const newImages = [...keptImages];
    for (let i = 0; i < imgFiles.length; i++) {
      setStatus(`Subiendo imágenes nuevas (${i + 1}/${imgFiles.length})…`);
      const file   = imgFiles[i];
      const base64 = await readFileAsBase64(file);
      const ext    = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fname  = `images/${projectId}_${Date.now()}_${i}.${ext}`;
      await ghPutBinaryFile(fname, base64, null, `Update image: ${title}`, cfg);
      newImages.push(fname);
    }

    setStatus('Guardando cambios…');
    const existing = await ghGetFile('projects.json', cfg);
    if (!existing) throw new Error('No se pudo leer projects.json');
    const data = JSON.parse(existing.content);
    const idx  = data.projects.findIndex(p => p.id === projectId);
    if (idx === -1) throw new Error('Proyecto no encontrado');

    const updated = {
      ...data.projects[idx],
      title, category, date: date || null, description: desc,
      technologies: tech ? tech.split(',').map(t => t.trim()).filter(Boolean) : [],
      images: newImages,
    };
    delete updated.image; // migrar campo viejo
    data.projects[idx] = updated;

    await ghPutTextFile('projects.json', JSON.stringify(data, null, 2), existing.sha, `Update project: ${title}`, cfg);
    const stateIdx = state.projects.findIndex(p => p.id === projectId);
    if (stateIdx !== -1) state.projects[stateIdx] = updated;
    renderAll();
    setStatus('¡Cambios guardados!', 'success');
    setTimeout(hideModal, 1800);
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    submitBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════════════
   MODAL CERTIFICACIÓN (nueva o editar — formulario unificado)
   ════════════════════════════════════════════════════════════════════ */

function showCertFormModal(existingCert) {
  if (!isEditorActive()) { showKeywordModal(); return; }
  const isEdit = !!existingCert;
  const c      = existingCert || {};
  const existingImages = getImages(c);

  const existingImgsHTML = isEdit && existingImages.length > 0
    ? `<div class="form-group">
         <label class="form-label">Imágenes actuales <span class="hint">(× para quitar)</span></label>
         <div class="current-imgs" id="cf-current-imgs">
           ${existingImages.map((img, i) => `
             <div class="current-img-item" data-img="${escHtml(img)}">
               <img src="./${escHtml(img)}" class="current-img-thumb" alt="Imagen ${i + 1}" />
               <button type="button" class="current-img-remove" aria-label="Quitar imagen">×</button>
             </div>`).join('')}
         </div>
       </div>` : '';

  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">${isEdit ? 'Editar certificación' : 'Nueva certificación'}</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label" for="cf-title">Título <span class="req">*</span></label>
      <input id="cf-title" type="text" class="form-input" placeholder="Nombre del curso o certificación" value="${escHtml(c.title || '')}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="cf-inst">Institución / Plataforma <span class="req">*</span></label>
        <input id="cf-inst" type="text" class="form-input" placeholder="Udemy, Coursera…" value="${escHtml(c.institution || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="cf-date">Fecha</label>
        <input id="cf-date" type="month" class="form-input" value="${escHtml(c.date || '')}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="cf-desc">Descripción <span class="hint">(opcional)</span></label>
      <textarea id="cf-desc" class="form-textarea" rows="3" placeholder="Breve descripción del curso…">${escHtml(c.description || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="cf-link">Link al certificado <span class="hint">(opcional)</span></label>
      <input id="cf-link" type="url" class="form-input" placeholder="https://…" value="${escHtml(c.link || '')}" />
    </div>
    ${existingImgsHTML}
    <div class="form-group">
      <label class="form-label" for="cf-imgs">${isEdit ? 'Agregar imágenes' : 'Imagen del diploma'} <span class="hint">(podés elegir varias)</span></label>
      <input id="cf-imgs" type="file" class="form-file" accept="image/*" multiple />
      <div class="new-imgs-preview" id="cf-new-previews"></div>
    </div>
    <div id="cf-status" class="upload-status" hidden></div>
    <div id="cf-error"  class="form-error"    hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="cf-submit">${isEdit ? 'Guardar cambios →' : 'Publicar →'}</button>
    </div>`);

  document.querySelectorAll('.current-img-remove').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.current-img-item').remove());
  });

  document.getElementById('cf-imgs').addEventListener('change', e => {
    const wrap = document.getElementById('cf-new-previews');
    wrap.innerHTML = '';
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const div = document.createElement('div');
        div.className = 'new-img-preview-item';
        div.innerHTML = `<img src="${ev.target.result}" class="new-img-thumb" alt="${escHtml(file.name)}" />`;
        wrap.appendChild(div);
      };
      reader.readAsDataURL(file);
    });
  });

  document.getElementById('cf-submit').addEventListener('click', () => {
    if (isEdit) submitCertEdit(c.id, existingImages);
    else        submitNewCert();
  });
}

function showCertEditModal(certId) {
  const cert = state.certifications.find(c => c.id === certId);
  if (!cert) return;
  showCertFormModal(cert);
}

async function submitNewCert() {
  if (!isEditorActive()) { hideModal(); showKeywordModal(); return; }
  const title    = document.getElementById('cf-title').value.trim();
  const inst     = document.getElementById('cf-inst').value.trim();
  const date     = document.getElementById('cf-date').value;
  const desc     = document.getElementById('cf-desc').value.trim();
  const link     = document.getElementById('cf-link').value.trim();
  const imgFiles = Array.from(document.getElementById('cf-imgs').files);
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
    description: desc, link: link || null, images: [],
  };

  try {
    for (let i = 0; i < imgFiles.length; i++) {
      setStatus(`Subiendo imágenes (${i + 1}/${imgFiles.length})…`);
      const file   = imgFiles[i];
      const base64 = await readFileAsBase64(file);
      const ext    = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fname  = `images/cert_${cert.id}_${i}.${ext}`;
      await ghPutBinaryFile(fname, base64, null, `Add cert image: ${title}`, cfg);
      cert.images.push(fname);
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

async function submitCertEdit(certId, originalImages) {
  if (!isEditorActive()) { hideModal(); showKeywordModal(); return; }
  const title    = document.getElementById('cf-title').value.trim();
  const inst     = document.getElementById('cf-inst').value.trim();
  const date     = document.getElementById('cf-date').value;
  const desc     = document.getElementById('cf-desc').value.trim();
  const link     = document.getElementById('cf-link').value.trim();
  const imgFiles = Array.from(document.getElementById('cf-imgs').files);
  const errEl    = document.getElementById('cf-error');
  const statusEl = document.getElementById('cf-status');
  const submitBtn= document.getElementById('cf-submit');

  if (!title || !inst) { showError(errEl, 'Título e institución son obligatorios.'); return; }
  const cfg = getGHConfig();
  if (!cfg) { hideModal(); showTokenModal(); return; }

  const keptImages = Array.from(document.querySelectorAll('#cf-current-imgs .current-img-item'))
    .map(el => el.dataset.img).filter(Boolean);

  submitBtn.disabled = true; errEl.hidden = true;
  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg; statusEl.hidden = false;
  };

  try {
    const removedImages = originalImages.filter(img => !keptImages.includes(img));
    for (const imgPath of removedImages) {
      try {
        const f = await ghGetFile(imgPath, cfg);
        if (f) await ghDeleteFile(imgPath, f.sha, `Remove cert image: ${title}`, cfg);
      } catch { /* continuar */ }
    }

    const newImages = [...keptImages];
    for (let i = 0; i < imgFiles.length; i++) {
      setStatus(`Subiendo imágenes nuevas (${i + 1}/${imgFiles.length})…`);
      const file   = imgFiles[i];
      const base64 = await readFileAsBase64(file);
      const ext    = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fname  = `images/cert_${certId}_${Date.now()}_${i}.${ext}`;
      await ghPutBinaryFile(fname, base64, null, `Update cert image: ${title}`, cfg);
      newImages.push(fname);
    }

    setStatus('Guardando cambios…');
    const existing = await ghGetFile('certifications.json', cfg);
    if (!existing) throw new Error('No se pudo leer certifications.json');
    const data = JSON.parse(existing.content);
    const idx  = data.certifications.findIndex(c => c.id === certId);
    if (idx === -1) throw new Error('Certificación no encontrada');

    const updated = {
      ...data.certifications[idx],
      title, institution: inst, date: date || null,
      description: desc, link: link || null, images: newImages,
    };
    delete updated.image;
    data.certifications[idx] = updated;

    await ghPutTextFile('certifications.json', JSON.stringify(data, null, 2), existing.sha, `Update certification: ${title}`, cfg);
    const stateIdx = state.certifications.findIndex(c => c.id === certId);
    if (stateIdx !== -1) state.certifications[stateIdx] = updated;
    renderCertifications();
    setStatus('¡Cambios guardados!', 'success');
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
   MODAL EDITAR CONTACTO
   ════════════════════════════════════════════════════════════════════ */

function showContactEditModal() {
  if (!isEditorActive()) return;
  const { linkedin, whatsapp, email } = state.contact;
  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">Contacto</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <p class="modal-sub">Dejá en blanco los que no quieras mostrar.</p>
    <div class="form-group">
      <label class="form-label" for="ct-linkedin">
        <span class="contact-form-icon">${CONTACT_ICONS.linkedin}</span> LinkedIn <span class="hint">(URL completa)</span>
      </label>
      <input id="ct-linkedin" type="url" class="form-input" placeholder="https://linkedin.com/in/tu-perfil" value="${escHtml(linkedin)}" />
    </div>
    <div class="form-group">
      <label class="form-label" for="ct-whatsapp">
        <span class="contact-form-icon">${CONTACT_ICONS.whatsapp}</span> WhatsApp <span class="hint">(con código de país, ej: 5491112345678)</span>
      </label>
      <input id="ct-whatsapp" type="text" class="form-input" placeholder="5491112345678" value="${escHtml(whatsapp)}" />
    </div>
    <div class="form-group">
      <label class="form-label" for="ct-email">
        <span class="contact-form-icon">${CONTACT_ICONS.email}</span> Email
      </label>
      <input id="ct-email" type="email" class="form-input" placeholder="hola@ejemplo.com" value="${escHtml(email)}" />
    </div>
    <div id="ct-status" class="upload-status" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="ct-save">Guardar →</button>
    </div>`);
  document.getElementById('ct-save').addEventListener('click', submitContactEdit);
}

async function submitContactEdit() {
  if (!isEditorActive()) { hideModal(); return; }
  const linkedin = document.getElementById('ct-linkedin').value.trim();
  const whatsapp = document.getElementById('ct-whatsapp').value.trim();
  const email    = document.getElementById('ct-email').value.trim();
  const statusEl = document.getElementById('ct-status');
  const saveBtn  = document.getElementById('ct-save');
  const cfg      = getGHConfig();
  if (!cfg) { hideModal(); showTokenModal(); return; }

  saveBtn.disabled = true;
  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg; statusEl.hidden = false;
  };

  try {
    setStatus('Guardando…');
    const existing = await ghGetFile('contact.json', cfg);
    await ghPutTextFile(
      'contact.json',
      JSON.stringify({ linkedin, whatsapp, email }, null, 2),
      existing?.sha || null,
      'Update contact',
      cfg
    );
    state.contact = { linkedin, whatsapp, email };
    renderContact();
    setStatus('¡Guardado!', 'success');
    setTimeout(hideModal, 1500);
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    saveBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════════════
   MODAL EDITAR HERO
   ════════════════════════════════════════════════════════════════════ */

function showHeroEditModal() {
  if (!isEditorActive()) return;
  const { line1, line2, sub } = state.hero;
  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">Textos del inicio</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <p class="modal-sub">El título grande y el subtítulo que se ven al abrir el portfolio.</p>
    <div class="form-group">
      <label class="form-label" for="hr-line1">Línea 1 <span class="hint">(color negro)</span></label>
      <input id="hr-line1" type="text" class="form-input" value="${escHtml(line1)}" placeholder="Trabajo" />
    </div>
    <div class="form-group">
      <label class="form-label" for="hr-line2">Línea 2 <span class="hint">(color amarillo)</span></label>
      <input id="hr-line2" type="text" class="form-input" value="${escHtml(line2)}" placeholder="seleccionado." />
    </div>
    <div class="form-group">
      <label class="form-label" for="hr-sub">Subtítulo</label>
      <input id="hr-sub" type="text" class="form-input" value="${escHtml(sub)}" placeholder="Diseño y desarrollo." />
    </div>
    <div id="hr-status" class="upload-status" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="hr-save">Guardar →</button>
    </div>`);
  document.getElementById('hr-save').addEventListener('click', submitHeroEdit);
}

async function submitHeroEdit() {
  if (!isEditorActive()) { hideModal(); return; }
  const line1 = document.getElementById('hr-line1').value.trim() || 'Trabajo';
  const line2 = document.getElementById('hr-line2').value.trim() || 'seleccionado.';
  const sub   = document.getElementById('hr-sub').value.trim()   || 'Diseño y desarrollo.';
  const statusEl = document.getElementById('hr-status');
  const saveBtn  = document.getElementById('hr-save');
  const cfg      = getGHConfig();
  if (!cfg) { hideModal(); showTokenModal(); return; }

  saveBtn.disabled = true;
  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg; statusEl.hidden = false;
  };
  try {
    setStatus('Guardando…');
    const existing = await ghGetFile('hero.json', cfg);
    await ghPutTextFile(
      'hero.json',
      JSON.stringify({ line1, line2, sub }, null, 2),
      existing?.sha || null,
      'Update hero text',
      cfg
    );
    state.hero = { line1, line2, sub };
    renderHero();
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
    for (const imgPath of getImages(project)) {
      try {
        const f = await ghGetFile(imgPath, cfg);
        if (f) await ghDeleteFile(imgPath, f.sha, `Remove image: ${project.title}`, cfg);
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
    for (const imgPath of getImages(cert)) {
      try {
        const f = await ghGetFile(imgPath, cfg);
        if (f) await ghDeleteFile(imgPath, f.sha, `Remove cert image: ${cert.title}`, cfg);
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

  await Promise.all([loadProjects(), loadAbout(), loadCertifications(), loadContact(), loadHero()]);

  renderHero();
  renderAll();
  renderAbout();
  renderCertifications();
  renderContactHeader();

  if (isEditorActive()) activateEditorMode();

  document.getElementById('fab-add').addEventListener('click', () => {
    if (isEditorActive()) showProjectFormModal(null);
    else                  showKeywordModal();
  });

  // Abrir detalle al hacer click en una tarjeta (excluir botones de acción)
  document.getElementById('projects-grid').addEventListener('click', e => {
    if (e.target.closest('.card-delete-btn, .card-edit-btn, .card-confirm-overlay')) return;
    const card = e.target.closest('.project-card');
    if (card) showProjectDetailModal(card.dataset.id);
  });

  document.getElementById('certs-section').addEventListener('click', e => {
    if (e.target.closest('.cert-delete-btn, .cert-edit-btn, .card-confirm-overlay, .add-cert-btn, button')) return;
    const card = e.target.closest('.cert-card');
    if (card) showCertDetailModal(card.dataset.id);
  });
});
