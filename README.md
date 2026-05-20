# Portfolio personal estático

Portfolio personal 100% estático, hosteable gratis en GitHub Pages, con editor integrado que guarda proyectos directamente en el repositorio vía GitHub API. Sin backend, sin base de datos, sin build step.

---

## Qué es

Un sitio de una sola página con:
- **Vista pública**: grilla de proyectos filtrable por categoría
- **Modo editor** (protegido): formulario para agregar/borrar proyectos usando la API de GitHub desde el propio navegador

Los datos viven en `projects.json`. Las imágenes se guardan en `/images/` dentro del mismo repo.

---

## Despliegue paso a paso

### 1. Crear el repositorio en GitHub

1. Ir a [github.com/new](https://github.com/new)
2. Nombre del repo: por ejemplo `portfolio` (anotalo — lo vas a necesitar)
3. Visibilidad: **Public** (requerido para GitHub Pages gratis)
4. Clic en **Create repository**

### 2. Subir los archivos

Desde la terminal, parado en la carpeta `portfolio/`:

```bash
git init
git add .
git commit -m "Initial portfolio"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

Reemplazá `TU_USUARIO` y `TU_REPO` con tus datos reales.

### 3. Activar GitHub Pages

1. En tu repo → **Settings** → **Pages** (menú lateral)
2. En *Source*: seleccioná **Deploy from a branch**
3. Branch: **main** · Folder: **/ (root)**
4. Clic en **Save**

En unos minutos el sitio estará en:
`https://TU_USUARIO.github.io/TU_REPO/`

> **Nota sobre caché**: después de agregar un proyecto, GitHub Pages puede tardar 1-5 minutos en reflejar los cambios. Es normal.

---

## Crear el Personal Access Token (PAT)

El token es lo que permite que el sitio escriba en tu repositorio.

1. Ir a [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
2. Clic en **Generate new token**
3. Configuración recomendada:
   - **Token name**: `portfolio-editor`
   - **Expiration**: 1 año (o "No expiration" si preferís)
   - **Repository access**: *Only select repositories* → elegir tu repo de portfolio
   - **Permissions** → **Contents**: `Read and write`
4. Clic en **Generate token**
5. **Copiá el token ahora** — no se vuelve a mostrar

> El token se guarda en `localStorage` de tu navegador. Nadie más puede verlo a menos que tenga acceso físico a tu máquina.

---

## Cómo agregar proyectos

1. Abrí tu portfolio en el navegador
2. Clic en el botón **+** (esquina inferior derecha)
3. Ingresá la **palabra clave** cuando se solicite
4. Si es la primera vez, completá el formulario de configuración de GitHub (usuario, repo, token, branch)
5. Completá el formulario del proyecto:
   - **Título** y **Categoría** son obligatorios
   - La imagen es opcional; si la subís se guarda en `/images/` del repo
6. Clic en **Publicar** — el sitio muestra el progreso ("Subiendo imagen…", "Guardando proyecto…")

Para **borrar** un proyecto: activá el modo editor con la palabra clave, luego pasá el cursor sobre la tarjeta y hacé clic en el botón `×`.

Para **salir** del modo editor: clic en *Salir* en el indicador del header, o cerrá la pestaña.

---

## Personalización

### Nombre y subtítulo

En `index.html`, buscá:
```html
<a href="/" class="site-name">Tu Nombre</a>
```
y más abajo:
```html
<p class="hero-sub">Proyectos de diseño, código y creación.</p>
```

### Colores

En `styles.css`, las variables al inicio:
```css
--bg:      #F5EFE4;   /* fondo crema */
--fg:      #1A1915;   /* texto carbón */
--accent:  #C4541B;   /* naranja quemado — cambialo por lo que quieras */
```

### Fuentes

En `index.html`, la URL de Google Fonts usa `Fraunces` (display) y `Geist` (body). Podés reemplazarlas actualizando tanto esa URL como las variables `--font-display` y `--font-body` en el CSS.

---

## Limitaciones de seguridad

> **La palabra clave NO es protección criptográfica.**

Es un *UI gate*: cualquier persona con conocimientos básicos puede abrir DevTools, leer el código fuente de `app.js` y encontrar la constante `KEYWORD`. Esto es intencional y documentado.

**Lo que la palabra clave sí hace:**
- Evita que vos (o cualquier visitante) toque proyectos sin querer
- Requiere confirmación explícita antes de cualquier operación de escritura
- Se resetea al cerrar la pestaña (sessionStorage)
- Bloquea el acceso por 5 minutos tras 5 intentos fallidos

**Lo que realmente protege los datos es el PAT**: sin ese token, la API de GitHub rechaza cualquier escritura, independientemente de si la palabra clave fue ingresada o no. El token vive solo en tu localStorage y nadie más lo tiene.

**Recomendación**: si el sitio es público, no uses el mismo PAT para nada crítico. Creá uno dedicado solo para este repo con permisos mínimos (Contents R/W únicamente).
