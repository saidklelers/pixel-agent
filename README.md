# Pixel Office

App de escritorio que muestra tus sesiones de **Claude Code** como personajes
pixel-art trabajando en una oficina virtual. No depende de VS Code: es un
observador que lee las transcripciones `.jsonl` que Claude Code escribe en
`~/.claude/projects/` y anima a cada agente según lo que está haciendo de verdad
(leyendo, escribiendo código, ejecutando comandos, buscando en la web, etc.).

## Requisitos
- Node.js 18+ (tienes v24, perfecto)

## Probarlo en desarrollo
```bash
cd C:\Proyectos\pixel-office
npm install
npm start
```
Abre una terminal aparte, lanza `claude` en cualquier proyecto y verás aparecer
a tu primer agente caminando hasta su escritorio.

## Crear el instalador + acceso directo en el escritorio
```bash
npm run dist
```
Genera en `dist/` un instalador (`Pixel Office Setup x.y.z.exe`). Al instalarlo
crea automáticamente el **acceso directo en el escritorio** y en el menú inicio.

## Cómo funciona
- `src/main.js` — proceso principal de Electron. Cada ~0.7 s lee lo nuevo de
  cada `.jsonl`, traduce los eventos (`tool_use`, mensajes, etc.) a un estado y
  envía la foto al render por IPC.
- `src/renderer/renderer.js` — dibuja la oficina y los personajes en un canvas.
- `src/preload.js` — puente seguro entre proceso principal y render.

### Cambiar la carpeta de proyectos
Por defecto usa `~/.claude/projects`. Para apuntar a otra, define la variable de
entorno `CLAUDE_PROJECTS_DIR` antes de arrancar.

## Ideas para ampliar
- Sprites reales (PNG) en vez de personajes dibujados a mano.
- Editor de layout de la oficina (muebles, paredes).
- Botón "+ Agente" que lance `claude` en una terminal nueva.
- Detección de "esperando permiso" para sacar un aviso.
