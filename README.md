# Pixel Office

App de escritorio con una oficina en **3D** (estilo acogedor, vista en diagonal) donde
trabaja tu equipo de agentes de **Claude Code**, animados según lo que están
haciendo de verdad (leyendo, escribiendo código, ejecutando comandos, buscando
en la web…).

Desde el **Centro de mando** (panel derecho) diriges a tu **equipo fijo de 5
IAs** (JARVIS, FRIDAY, TARS, EDITH y KITT), cada una especializada en una parte
del desarrollo, **escribiendo o hablando**; te contestan **en voz alta**.

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
El equipo entra por la puerta y cada uno va a su mesa. Necesitas tener Claude
Code con sesión iniciada (ejecuta `claude` una vez en una terminal).

## La oficina (3D)
- Oficina en **3D real** (Three.js): puerta de entrada, ventanas, pizarra,
  reloj real, estantería, zona de café, sofá, mesa holográfica en el centro y
  un gato que pasea (haz clic en él 🐱).
- El equipo son **chibis en 3D**, cada uno con su estilo: JARVIS con traje y
  auricular, FRIDAY con diadema, TARS es un robot con cara de pantalla, EDITH
  con gafas y KITT con el visor y su escáner rojo. Entran por la puerta, se
  sientan en su mesa, teclean, parpadean y mueven la boca al hablar.
- El cielo y la luz siguen la hora real: de día entra el sol con sombras; de
  noche se encienden los plafones, los flexos y las pantallas.
- **Arrastra** para girar la cámara, **rueda** para acercar, **doble clic**
  para volver a la vista inicial.
- **Clic en un personaje** (o en su mesa/bocadillo): pasa a ser el destino.
  **Ctrl+clic** lo marca para difusión.
- Si el PC no tiene WebGL, se usa automáticamente la versión 2.5D.

## Tu equipo: 5 IAs fijas 🤖

| Miembro | De | Especialidad |
|---|---|---|
| 🧠 **JARVIS** | Iron Man | Arquitecto y líder técnico: planifica, divide tareas, revisa |
| 🎨 **FRIDAY** | Iron Man | Frontend y UI/UX |
| 🗄️ **TARS** | Interstellar | Backend, APIs y bases de datos |
| 🛡️ **EDITH** | Spider-Man | QA, tests y seguridad |
| 🚀 **KITT** | El coche fantástico | DevOps: build, CI/CD, git y despliegue |

- Siempre son los mismos cinco. Cada uno es una sesión de Claude Code con su
  especialidad, y **recuerda la conversación** aunque cierres la app (una por
  carpeta de proyecto; la carpeta se elige en el campo 📁 del panel).
- **Capacitaciones**: pídele a uno que se forme en algo concreto («KITT,
  capacítate en Kubernetes», o escribe el tema y pulsa **🎓 Capacitar**).
  Investiga el tema, guarda sus notas y desde entonces las tiene siempre en
  cuenta. Sus capacitaciones aparecen en su ficha (✅ aprendido, ⏳ aprendiendo);
  con ✕ las olvida.
- **↺** en la ficha (o «Reinicia a TARS») le hace olvidar la conversación; lo
  aprendido se conserva.
- Se guarda todo en `equipo.json`, en la carpeta de datos de la app.

## Hablar con el equipo 🎤
1. Mantén pulsado **🎤** (o **Ctrl+Espacio**) mientras hablas y suelta para
   enviar. O haz **un clic y habla**: se envía solo cuando te callas.
   **Esc** cancela.
2. La primera vez se descarga el modelo de voz y verás una barra de progreso.
   En **🎙️ Te entiendo** eliges la precisión: **Preciso** (Whisper *small*,
   ~500 MB, mucho mejor en español; por defecto) o **Rápido** (Whisper *base*,
   ~130 MB, para PCs modestos). Antes de transcribir se recortan los silencios y
   se ajusta el volumen de la grabación. La transcripción es **local**: el audio no sale de tu
   PC y no hace falta ninguna clave. En la terminal donde lanzaste `npm start`
   verás `[voz] transcrito: «…»` con lo que ha entendido.
3. Lo que digas (o escribas) se interpreta como una orden:

| Dices | Qué hace |
|---|---|
| «JARVIS, planifica el login» | Solo a JARVIS |
| «FRIDAY y EDITH: revisad el formulario» | A varios a la vez |
| «Todos, actualizad la rama» | A todo el equipo |
| «KITT, capacítate en Kubernetes» | Capacitación (lo recuerda siempre) |
| «Para» / «TARS, para» / «Todos, paren» | Interrumpe el turno actual |
| «Reinicia a TARS» | Olvida la conversación (pide confirmación) |
| «EDITH» | EDITH pasa a ser el destino |
| «Silencio» | Calla las voces |
| Cualquier otra frase | Va al destino actual (por defecto, JARVIS) |

Los nombres se reconocen aunque Whisper los escriba distinto (Yarvis, Fraidei,
Kit…). «Para» solo cuenta como orden si es toda la frase.

Mientras grabas, el equipo no habla (para que el micro no capte su voz). El
micro se corta solo a los 2 minutos o al cambiar de ventana.

### Respuestas habladas 🔊
Cada miembro habla con su propia **voz natural** (voces neuronales de
Microsoft, las de «Leer en voz alta» de Edge), que suenan como una persona:

| Miembro | Voz |
|---|---|
| JARVIS | Álvaro (España) |
| FRIDAY | Dalia (México) |
| TARS | Jorge (México), más grave |
| EDITH | Elvira (España) |
| KITT | Tomás (Argentina) |

- Necesitan internet: el texto de la respuesta se envía al servicio de voz de
  Microsoft para convertirlo en audio (no hace falta cuenta ni clave). Si no
  hay conexión, se usa automáticamente la voz del sistema y te avisa.
- En **🔊 Voces** puedes elegir «Del sistema» si prefieres que nada salga de
  tu PC (suena más robótica).
- Se omiten los bloques de código y el markdown. **🔊** en la cabecera
  activa/desactiva la lectura; **⏹** (o **Esc**) calla a todos.

### Si el micrófono no funciona
- *Configuración › Privacidad y seguridad › Micrófono*: activa «Permitir que las
  aplicaciones de escritorio accedan al micrófono».
- Si la voz falla al cargar en un Windows recién instalado, instala el
  *Microsoft Visual C++ Redistributable* (x64), que usa el motor ONNX.
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
- `src/team.js` — el equipo: nombres, especialidades, aspecto y prompts.
- `src/main.js` — proceso principal de Electron: sesiones del equipo con el
  Claude Agent SDK (reanudables), capacitaciones, estado para el render y
  permiso del micrófono (solo audio).
- `src/stt-worker.js` — motor de voz: Whisper local en un proceso aparte
  (`utilityProcess`) para no congelar la ventana.
- `src/renderer/office3d.js` — la oficina 3D (Three.js) y los chibis.
- `src/renderer/renderer.js` — versión 2.5D de respaldo si no hay WebGL.
- `src/renderer/chat.js` — Centro de mando: agentes, órdenes, micro y voces.
- `src/renderer/voice.js` — grabación del micrófono y cola de voces.
- `src/renderer/voice-commands.js` — intérprete de órdenes habladas.
- `src/preload.js` — puente seguro entre proceso principal y render.


## Ideas para ampliar
- Sprites reales (PNG) en vez de personajes dibujados a mano.
- Editor de layout de la oficina (muebles, paredes).
- Palabra de activación («Oye oficina…») sin tener que pulsar el micro.
- Detección de "esperando permiso" para sacar un aviso.
