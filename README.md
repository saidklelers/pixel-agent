# Pixel Office

App de escritorio con una oficina **ciberpunk en 3D** donde
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

## La oficina (3D ciberpunk)
- Oficina en **3D real** (Three.js) con estilo **ciberpunk**:
  - suelo metálico con rejilla de neón;
  - tiras de neón en paredes y suelo;
  - letrero «PIXEL OFFICE» y reloj LED;
  - tablero holográfico con gráficas y rack de servidores con luces;
  - máquina expendedora, depósito de refrigerante y sofá con luz de suelo;
  - mesa holográfica en el centro;
  - ventanas a una ciudad con carteles de neón y coches voladores;
  - resplandor (*bloom*) en todo lo que brilla;
  - neones animados: respiran, alguno parpadea como un tubo viejo y por las tiras corren destellos de luz.
- El equipo son **chibis en 3D**, cada uno con su estilo:
  - JARVIS con traje y auricular;
  - FRIDAY con diadema;
  - TARS, un robot con cara de pantalla;
  - EDITH con gafas;
  - KITT con el visor y su escáner rojo.
- **Tienen vida propia**: cuando no tienen trabajo, al rato se levantan y pasean por la oficina. Van a por café o agua, a la máquina, al sofá, a mirar la ciudad por la ventana, a consultar el holograma o a ver qué hace un compañero que está trabajando. El bocadillo dice qué están haciendo. En cuanto les llega una orden, **vuelven corriendo a su mesa**. Se mueven por los pasillos, sin atravesar muebles.
- Cada mesa tiene una pantalla holográfica que muestra **lo que ese miembro está haciendo de verdad**: el código que escribe, el comando que ejecuta y su salida, su plan…
- El **tablero de la pared** muestra las tareas reales del equipo: qué hace cada uno, cuántas tiene en cola, cuántas ha terminado y lo que lleva gastado.
- El cielo y la luz siguen la hora real: de día, sol anaranjado de ciudad; de noche mandan los neones.
- **Arrastra** para girar la cámara, **rueda** para acercar y **doble clic** para volver a la vista inicial.
- **Clic en un personaje** (aunque esté paseando), en su mesa o en su bocadillo: pasa a ser el destino. **Ctrl+clic** lo marca para difusión.
- **Clic en la pantalla de su mesa**: se abre su pantalla en grande (ver abajo). **Clic en el tablero de la pared**: la fila de un miembro abre su pantalla.
- Si el PC no tiene WebGL, se usa automáticamente la versión 2.5D.

## El Centro de mando (panel derecho)
- **Arriba**, los 5 del equipo como avatares, cada uno con su anillo de estado:
  - un aro amarillo gira si está trabajando;
  - late en verde si está hablando;
  - cian si es tu destino y magenta si lo has marcado para difusión.
  - **Clic** para hablarle; **Ctrl+clic** para marcar a varios.
- **Ficha** del seleccionado: especialidad, qué está haciendo ahora mismo, sus capacitaciones (y «＋ Capacitar») y ↺ para reiniciar su conversación.
- **Conversación**:
  - las respuestas se muestran con formato (código, negritas) y la hora de cada mensaje;
  - las acciones seguidas se agrupan en un desplegable «⚙ N acciones»;
  - al final aparece «JARVIS · trabajando…» con lo que hace;
  - si subes a leer, un botón ↓ te lleva al último mensaje;
  - si está vacía, sugiere órdenes típicas de cada especialista.
- **Caja de escribir**: «Para» con chips de los destinatarios, 🎤 y ➤ dentro de la caja, y **Enter** para enviar (Shift+Enter hace un salto de línea).
- **⚙️ Ajustes** (carpeta del proyecto, micrófono, reconocimiento de voz, tipo de voces, personalizar equipo) y **❔ Ayuda** se abren como paneles desde la cabecera. **📋** abre las pantallas del equipo.
- En la ficha: **🖥️** abre su pantalla y **✎** lo personaliza.
- Arrastra el **borde izquierdo** del panel para ensancharlo; doble clic en ese borde lo devuelve al ancho normal.

## Las pantallas del equipo 🖥️
Para ver qué está haciendo o validando cada uno. Se abren con un clic en la
pantalla holográfica de su mesa, con 🖥️ en su ficha o con **📋** en la cabecera
del panel (vista de todo el equipo). **Esc** las cierra.

- **Su pantalla, en directo** (● EN DIRECTO):
  - si edita un archivo, ves el cambio (líneas quitadas en rojo y añadidas en verde);
  - si crea uno, su contenido;
  - si ejecuta un comando, la terminal con la salida; los tests, lint y build aparecen como **🧪 Validando**, con ✓ correcto o ✗ falló;
  - también lo que lee, lo que busca (en el proyecto o en la web) y lo que dice.
- **Su plan**: la lista de pasos que se marca el agente, con los que ya ha hecho tachados y una barra de progreso.
- **Sus tareas**: la que está **en curso**, las que tiene **en cola** (si le mandas otra orden mientras trabaja, espera su turno) y las **hechas**, con hora, duración y coste. Clic en una para ver cómo la hizo.
- **Pasos de la tarea**: todo lo que ha hecho, en orden. Clic en un paso para verlo en la pantalla; «▶ Seguir en directo» vuelve a lo último.
- **Gastado**: lo que lleva gastado cada uno (coste estimado que da Claude Code) y el total del equipo.
- **📋 Equipo**: las 5 pantallas a la vez y el tablero de todos (**Pendiente → En curso → Hecho**).
- Las tareas se guardan en `tareas.json` (carpeta de datos de la app). «Limpiar» quita las terminadas.

## Personalizar el equipo 🎨
En **⚙️ Ajustes › 🎨 Personalizar equipo** (o ✎ en la ficha) puedes cambiar a cada miembro:
- **Nombre** (con él le llamas, también por voz) y **emoji**.
- **Especialidad** y **en qué se inspira**.
- **Instrucciones**: quién es y en qué se especializa (se le dan siempre como contexto).
- **Colores**: el neón de su mesa, la ropa y el pelo. Su mesa y su personaje cambian al momento.
- **Voz**: 17 voces naturales en español (España, México, Argentina, Colombia, Chile, Perú, Venezuela y EE. UU.), con tono y velocidad. **▶ Probar voz** la escuchas antes de guardar.
- **↺ Volver al original** deshace sus cambios.

Si le cambias el nombre, sus compañeros también se enteran. Conserva su conversación y lo aprendido. Si está trabajando, las nuevas instrucciones se aplican cuando termine.

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
Prueban el intérprete de órdenes por voz (`src/renderer/voice-commands.js`), el
tablero de tareas (`src/board.js`) y la personalización del equipo (`src/team.js`).

## Crear el instalador + acceso directo en el escritorio
```bash
npm run dist
```
Genera en `dist/` un instalador (`Pixel Office Setup x.y.z.exe`). Al instalarlo
crea automáticamente el **acceso directo en el escritorio** y en el menú inicio.

## Cómo funciona
- `src/team.js` — el equipo: nombres, especialidades, aspecto, prompts y personalización.
- `src/board.js` — el tablero de tareas: órdenes, pasos de cada agente y coste.
- `src/main.js` — proceso principal de Electron: sesiones del equipo con el
  Claude Agent SDK (reanudables), capacitaciones, estado para el render y
  permiso del micrófono (solo audio).
- `src/stt-worker.js` — motor de voz: Whisper local en un proceso aparte
  (`utilityProcess`) para no congelar la ventana.
- `src/renderer/office3d.js` — la oficina 3D ciberpunk (Three.js), los chibis y sus paseos.
- `src/renderer/renderer.js` — versión 2.5D de respaldo si no hay WebGL.
- `src/renderer/chat.js` — Centro de mando: agentes, órdenes, micro y voces.
- `src/renderer/screen.js` — las pantallas de los agentes y el tablero del equipo.
- `src/renderer/team-editor.js` — Personalizar equipo.
- `src/renderer/voice.js` — grabación del micrófono y cola de voces.
- `src/renderer/voice-commands.js` — intérprete de órdenes habladas.
- `src/preload.js` — puente seguro entre proceso principal y render.


## Ideas para ampliar
- Sprites reales (PNG) en vez de personajes dibujados a mano.
- Editor de layout de la oficina (muebles, paredes).
- Palabra de activación («Oye oficina…») sin tener que pulsar el micro.
- Detección de "esperando permiso" para sacar un aviso.
