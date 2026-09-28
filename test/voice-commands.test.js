'use strict';

// Tests del parser de órdenes por voz: `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, speechText, isNoise, phonKey } = require('../src/renderer/voice-commands.js');

// Nombres del equipo y alias (como los escribe Whisper)
const NAMES = [
  { name: 'JARVIS', aliases: ['Yarvis', 'Jarbis'] },
  { name: 'FRIDAY', aliases: ['Fraidei'] },
  'TARS',
  { name: 'EDITH', aliases: ['Edit'] },
  { name: 'KITT', aliases: ['Kit'] },
];
const p = (t) => parseCommand(t, NAMES);

test('mensaje sin destinatario va al destino actual', () => {
  assert.deepEqual(p('Revisa los tests, por favor.'), { type: 'send', to: null, text: 'Revisa los tests, por favor' });
});

test('dirigirse por nombre', () => {
  assert.deepEqual(p('Jarvis, revisa la arquitectura.'), { type: 'send', to: ['JARVIS'], text: 'revisa la arquitectura' });
  assert.deepEqual(p('Jarvis revisa la arquitectura'), { type: 'send', to: ['JARVIS'], text: 'revisa la arquitectura' });
  assert.deepEqual(p('Oye, Kit: haz el deploy'), { type: 'send', to: ['KITT'], text: 'haz el deploy' });
  assert.deepEqual(p('Friday y Edith, revisad el login'), { type: 'send', to: ['FRIDAY', 'EDITH'], text: 'revisad el login' });
  assert.deepEqual(p('Tars, Kitt: sincronizaos'), { type: 'send', to: ['TARS', 'KITT'], text: 'sincronizaos' });
});

test('nombre partido en dos palabras (Whisper)', () => {
  assert.deepEqual(p('Y Arvis, revisa los testes del proyecto por favor.'), { type: 'send', to: ['JARVIS'], text: 'revisa los testes del proyecto por favor' });
  assert.deepEqual(p('Fra idei, revisa el formulario'), { type: 'send', to: ['FRIDAY'], text: 'revisa el formulario' });
  // una palabra normal detrás del nombre no se confunde con otro nombre
  assert.deepEqual(p('Tars, revisa'), { type: 'send', to: ['TARS'], text: 'revisa' });
});

test('nombres con otra ortografía (Whisper)', () => {
  assert.deepEqual(p('Yarvis, planifica'), { type: 'send', to: ['JARVIS'], text: 'planifica' });
  assert.deepEqual(p('Fraidei, cambia los colores'), { type: 'send', to: ['FRIDAY'], text: 'cambia los colores' });
  assert.deepEqual(p('Tarz, optimiza la consulta'), { type: 'send', to: ['TARS'], text: 'optimiza la consulta' });
  assert.equal(phonKey('Kitt'), phonKey('Kit'));
});

test('un nombre que no es del equipo no se trata como destinatario', () => {
  assert.deepEqual(p('Marta, revisa esto'), { type: 'send', to: null, text: 'Marta, revisa esto' });
  assert.deepEqual(p('Kitten, revisa esto'), { type: 'send', to: null, text: 'Kitten, revisa esto' });
});

test('"JARVIS, y luego…" no confunde la coma con otro nombre', () => {
  assert.deepEqual(p('Jarvis, y luego sube los cambios'), { type: 'send', to: ['JARVIS'], text: 'y luego sube los cambios' });
});

test('difusión a todos', () => {
  assert.deepEqual(p('Todos, paren.'), { type: 'interrupt', to: 'all' });
  assert.deepEqual(p('todos paren'), { type: 'interrupt', to: 'all' });
  assert.deepEqual(p('Todo el mundo: actualizad la rama'), { type: 'send', to: 'all', text: 'actualizad la rama' });
  assert.deepEqual(p('Todos los tests fallan, arréglalos'), { type: 'send', to: null, text: 'Todos los tests fallan, arréglalos' });
});

test('detener (interrumpir el turno)', () => {
  assert.deepEqual(p('Para.'), { type: 'interrupt', to: null });
  assert.deepEqual(p('Detente ya, por favor'), { type: 'interrupt', to: null });
  assert.deepEqual(p('Kitt, para'), { type: 'interrupt', to: ['KITT'] });
  assert.deepEqual(p('Para, Tars.'), { type: 'interrupt', to: ['TARS'] });
  assert.deepEqual(p('Detén a Edith'), { type: 'interrupt', to: ['EDITH'] });
  assert.deepEqual(p('Paren todos'), { type: 'interrupt', to: 'all' });
  // "para" como preposición no es una orden de parada
  assert.deepEqual(p('Edith, para cada archivo añade un test'), { type: 'send', to: ['EDITH'], text: 'para cada archivo añade un test' });
  assert.deepEqual(p('Para el servidor de desarrollo'), { type: 'send', to: null, text: 'Para el servidor de desarrollo' });
});

test('reiniciar la conversación solo con nombre', () => {
  assert.deepEqual(p('Reinicia a Tars'), { type: 'reset', to: ['TARS'] });
  assert.deepEqual(p('Tars, reiníciate'), { type: 'reset', to: ['TARS'] });
  assert.deepEqual(p('Resetea a Friday y Edith'), { type: 'reset', to: ['FRIDAY', 'EDITH'] });
  // sin nombre, con "todos" o con complemento: es una tarea normal
  assert.deepEqual(p('Reinicia el servidor'), { type: 'send', to: null, text: 'Reinicia el servidor' });
  assert.deepEqual(p('Reinicia.'), { type: 'send', to: null, text: 'Reinicia' });
  assert.deepEqual(p('Reinicia a todos'), { type: 'send', to: null, text: 'Reinicia a todos' });
  assert.deepEqual(p('Kitt, termina'), { type: 'send', to: ['KITT'], text: 'termina' });
});

test('capacitación', () => {
  assert.deepEqual(p('Kitt, capacítate en Kubernetes.'), { type: 'train', to: ['KITT'], topic: 'Kubernetes' });
  assert.deepEqual(p('Friday, especialízate en React y Tailwind'), { type: 'train', to: ['FRIDAY'], topic: 'React y Tailwind' });
  assert.deepEqual(p('Edith, aprende sobre OWASP Top 10'), { type: 'train', to: ['EDITH'], topic: 'OWASP Top 10' });
  assert.deepEqual(p('Tars, fórmate en PostgreSQL'), { type: 'train', to: ['TARS'], topic: 'PostgreSQL' });
  assert.deepEqual(p('Capacítate en la API de Stripe'), { type: 'train', to: null, topic: 'API de Stripe' });
  // "aprende" sin tema no es capacitación
  assert.equal(p('Jarvis, aprende').type, 'send');
});

test('silencio y selección', () => {
  assert.deepEqual(p('¡Silencio!'), { type: 'silence' });
  assert.deepEqual(p('Cállate, por favor'), { type: 'silence' });
  assert.deepEqual(p('Edith.'), { type: 'select', to: ['EDITH'] });
  assert.deepEqual(p('Oye Jarvis'), { type: 'select', to: ['JARVIS'] });
  assert.deepEqual(p('  '), { type: 'empty' });
});

test('sin lista de nombres también funciona', () => {
  assert.deepEqual(parseCommand('Jarvis, revisa', []), { type: 'send', to: null, text: 'Jarvis, revisa' });
  assert.deepEqual(parseCommand('para', undefined), { type: 'interrupt', to: null });
});

test('speechText quita código y markdown y recorta', () => {
  const md = '## Hecho\n\nHe corregido `main.js`:\n\n```js\nconst a = 1;\n```\n\n- **Test** en verde\n- Ver [docs](https://x.y/z)';
  const s = speechText(md);
  assert.ok(!s.includes('```') && !s.includes('const a') && !s.includes('**') && !s.includes('#'));
  assert.ok(s.includes('main.js'));
  assert.ok(s.includes('docs'));
  assert.ok(s.endsWith('Te dejo el código en el chat.'));

  const long = 'Frase uno bastante larga para rellenar. '.repeat(20);
  const cut = speechText(long, 120);
  assert.ok(cut.length <= 120);
  assert.ok(cut.endsWith('.'));
  assert.equal(speechText('Visita https://example.com ya'), 'Visita un enlace ya');
});

test('isNoise detecta alucinaciones típicas de Whisper', () => {
  for (const n of ['', '...', '[Música]', '(risas)', 'Subtítulos realizados por la comunidad de Amara.org', '¡Suscríbete!', 'Gracias por ver el video.', 'Gracias.']) {
    assert.equal(isNoise(n), true, n);
  }
  for (const ok of ['Jarvis, revisa los tests', 'para', 'Gracias, Jarvis']) assert.equal(isNoise(ok), false, ok);
});
