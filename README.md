# Pixel Office

App de escritorio que muestra tus sesiones de **Claude Code** como personajes
pixel-art trabajando en una oficina virtual en **2.5D (isométrica)**. No depende
de VS Code: es un observador que lee las transcripciones `.jsonl` que Claude Code
escribe en `~/.claude/projects/` y anima a cada agente según lo que está haciendo
de verdad (leyendo, escribiendo código, ejecutando comandos, buscando en la web…).

Desde el **Centro de mando** (panel derecho) puedes lanzar agentes y darles
órdenes **escribiendo o hablando**, y ellos te contestan **en voz alta**.

## Requisitos
- Node.js 18+ (tienes v24, perfecto)
- Windows 10/11 con micrófono (para la voz)

## Probarlo en desarrollo
```bash
cd C:\Proyectos\pixel-office
git pull
npm install
npm start
```
Abre una terminal aparte, lanza `claude` en cualquier proyecto y verás aparecer
a tu primer agente entrando por la puerta y caminando hasta su mesa.

## La oficina
- Vista isométrica con puerta de entrada, ventanas, pizarra, reloj real, zona de
  café, sofá y un gato que pasea (haz clic en él 🐱).
- El cielo de las ventanas y la luz cambian con la hora real (día, atardecer y
  noche, cuando se encienden los portátiles y los flexos).
- Cada personaje lleva un bocadillo con su nombre y lo que está haciendo.
- **Clic en un personaje** (o en su mesa): pasa a ser el destino de tus órdenes.
  **Ctrl+clic** lo marca para difusión (varios a la vez).

## Hablar con los agentes 🎤
1. Mantén pulsado el botón **🎤** (o **Ctrl+Espacio**) mientras hablas y suelta
   para enviar. Un clic corto deja el micro abierto hasta el siguiente clic.
   **Esc** cancela.
2. La primera vez se descarga el modelo de voz (Whisper *base*, ~130 MB) y verás
   una barra de progreso. Se guarda en la carpeta de datos de la app y las
   siguientes veces arranca al instante. La transcripción es **local**: el audio
   no sale de tu PC y no hace falta ninguna clave.
3. Lo que digas se interpreta como una orden:

| Dices | Qué hace |
|---|---|
| «Ana, revisa los tests» | Manda la orden solo a Ana |
| «Ana y Beto: haced un commit» | A varios agentes a la vez |
| «Todos, actualizad la rama» | Difusión a todos los agentes activos |
| «Nuevo agente llamado Leo: documenta la API» | Lanza un agente nuevo con esa tarea |
| «Nuevo agente llamado Leo» (y luego la tarea) | Te pregunta qué tiene que hacer |
| «Para» / «Ana, para» / «Todos, paren» | Interrumpe el turno actual |
| «Despide a Leo» | Cierra la sesión de Leo |
| «Ana» | Ana pasa a ser el destino |
| «Silencio» | Calla las voces de los agentes |
| Cualquier otra frase | Va al destino actual (o crea un agente si no hay ninguno) |

Los nombres se reconocen aunque Whisper los escriba distinto (Beto/Veto,
Uxía/Uxia, Ximo/Chimo…). «Para» solo cuenta como orden si es toda la frase: «Ana,
para cada archivo añade un test» se envía tal cual.

### Respuestas habladas 🔊
- Los agentes leen sus respuestas con las voces en español de Windows (una voz
  o un tono distinto por agente). Se omiten los bloques de código y el markdown.
- **🔊** en la cabecera activa/desactiva la lectura; **⏹** (o **Esc**) calla a
  todos. Al pulsar el micro, los agentes se callan para escucharte.
- Si solo oyes una voz, instala más en *Configuración › Hora e idioma › Voz*.

### Si el micrófono no funciona
- *Configuración › Privacidad y seguridad › Micrófono*: activa «Permitir que las
  aplicaciones de escritorio accedan al micrófono».
- Para usar otro modelo (p. ej. más preciso), define `PIXEL_OFFICE_WHISPER`
  antes de arrancar, por ejemplo `onnx-community/whisper-small`.

## Tests
```bash
npm test
```
Prueban el intérprete de órdenes por voz (`src/renderer/voice-commands.js`).

## Crear el instalador + acceso directo en el escritorio
```bash
npm run dist
```
Genera en `dist/` un instalador (`Pixel Office Setup x.y.z.exe`). Al instalarlo
crea automáticamente el **acceso directo en el escritorio** y en el menú inicio.

## Cómo funciona
- `src/main.js` — proceso principal de Electron. Cada ~0.7 s lee lo nuevo de
  cada `.jsonl`, traduce los eventos (`tool_use`, mensajes, etc.) a un estado y
  envía la foto al render por IPC. También lanza los agentes del Centro de mando
  (Claude Agent SDK) y gestiona el permiso del micrófono (solo audio).
- `src/stt-worker.js` — motor de voz: Whisper local en un proceso aparte
  (`utilityProcess`) para no congelar la ventana.
- `src/renderer/renderer.js` — dibuja la oficina isométrica en un canvas.
- `src/renderer/chat.js` — Centro de mando: agentes, órdenes, micro y voces.
- `src/renderer/voice.js` — grabación del micrófono y cola de voces.
- `src/renderer/voice-commands.js` — intérprete de órdenes habladas.
- `src/preload.js` — puente seguro entre proceso principal y render.

### Cambiar la carpeta de proyectos
Por defecto usa `~/.claude/projects`. Para apuntar a otra, define la variable de
entorno `CLAUDE_PROJECTS_DIR` antes de arrancar.

## Ideas para ampliar
- Sprites reales (PNG) en vez de personajes dibujados a mano.
- Editor de layout de la oficina (muebles, paredes).
- Palabra de activación («Oye oficina…») sin tener que pulsar el micro.
- Detección de "esperando permiso" para sacar un aviso.
