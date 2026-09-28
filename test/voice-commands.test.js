'use strict';

// Tests del parser de órdenes por voz: `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, speechText, isNoise, phonKey } = require('../src/renderer/voice-commands.js');

const NAMES = ['Ana', 'Beto', 'Leo', 'Uxía', 'Ximo', 'Gabi', 'Agente 7'];
const p = (t) => parseCommand(t, NAMES);

test('mensaje sin destinatario va al destino actual', () => {
  assert.deepEqual(p('Revisa los tests, por favor.'), { type: 'send', to: null, text: 'Revisa los tests, por favor' });
});

test('dirigirse por nombre', () => {
  assert.deepEqual(p('Ana, revisa los tests.'), { type: 'send', to: ['Ana'], text: 'revisa los tests' });
  assert.deepEqual(p('Ana revisa los tests'), { type: 'send', to: ['Ana'], text: 'revisa los tests' });
  assert.deepEqual(p('Oye, Beto: haz un commit'), { type: 'send', to: ['Beto'], text: 'haz un commit' });
  assert.deepEqual(p('Ana y Beto, haced un commit'), { type: 'send', to: ['Ana', 'Beto'], text: 'haced un commit' });
  assert.deepEqual(p('Ana, Beto: sincronizaos'), { type: 'send', to: ['Ana', 'Beto'], text: 'sincronizaos' });
  assert.deepEqual(p('Agente 7, mira el log'), { type: 'send', to: ['Agente 7'], text: 'mira el log' });
});

test('nombres con otra ortografía (Whisper)', () => {
  assert.deepEqual(p('Veto, compila'), { type: 'send', to: ['Beto'], text: 'compila' });
  assert.deepEqual(p('Uxia, lee el README'), { type: 'send', to: ['Uxía'], text: 'lee el README' });
  assert.deepEqual(p('Chimo, despliega'), { type: 'send', to: ['Ximo'], text: 'despliega' });
  assert.deepEqual(p('Gaby, prueba'), { type: 'send', to: ['Gabi'], text: 'prueba' });
  assert.equal(phonKey('Hugo'), phonKey('Ugo'));
});

test('un nombre que no existe no se trata como destinatario', () => {
  assert.deepEqual(p('Marta, revisa esto'), { type: 'send', to: null, text: 'Marta, revisa esto' });
  assert.deepEqual(p('Anabel, revisa esto'), { type: 'send', to: null, text: 'Anabel, revisa esto' });
});

test('"Ana, y luego…" no confunde la coma con otro nombre', () => {
  assert.deepEqual(p('Ana, y luego sube los cambios'), { type: 'send', to: ['Ana'], text: 'y luego sube los cambios' });
});

test('difusión a todos', () => {
  assert.deepEqual(p('Todos, paren.'), { type: 'interrupt', to: 'all' });
  assert.deepEqual(p('todos paren'), { type: 'interrupt', to: 'all' });
  assert.deepEqual(p('Todo el mundo: actualizad la rama'), { type: 'send', to: 'all', text: 'actualizad la rama' });
  // "todos los tests…" es un mensaje normal, no una difusión
  assert.deepEqual(p('Todos los tests fallan, arréglalos'), { type: 'send', to: null, text: 'Todos los tests fallan, arréglalos' });
});

test('detener (interrumpir el turno)', () => {
  assert.deepEqual(p('Para.'), { type: 'interrupt', to: null });
  assert.deepEqual(p('Detente ya, por favor'), { type: 'interrupt', to: null });
  assert.deepEqual(p('Ana, para'), { type: 'interrupt', to: ['Ana'] });
  assert.deepEqual(p('Para, Ana.'), { type: 'interrupt', to: ['Ana'] });
  assert.deepEqual(p('Detén a Leo'), { type: 'interrupt', to: ['Leo'] });
  assert.deepEqual(p('Paren todos'), { type: 'interrupt', to: 'all' });
  // "para" como preposición no es una orden de parada
  assert.deepEqual(p('Ana, para cada archivo añade un test'), { type: 'send', to: ['Ana'], text: 'para cada archivo añade un test' });
  assert.deepEqual(p('Para el servidor de desarrollo'), { type: 'send', to: null, text: 'Para el servidor de desarrollo' });
});

test('despedir (cerrar la sesión del agente)', () => {
  assert.deepEqual(p('Despide a Leo'), { type: 'stop', to: ['Leo'] });
  assert.deepEqual(p('Leo, termina'), { type: 'stop', to: ['Leo'] });
  assert.deepEqual(p('Elimina a Ana y Beto'), { type: 'stop', to: ['Ana', 'Beto'] });
});

test('nuevo agente', () => {
  assert.deepEqual(p('Nuevo agente llamado Leo: revisa los tests.'), { type: 'spawn', name: 'Leo', text: 'revisa los tests' });
  assert.deepEqual(p('Crea un agente que se llame marta y que revise el README'), { type: 'spawn', name: 'Marta', text: 'revise el README' });
  assert.deepEqual(p('Lanza un nuevo agente para que documente la API'), { type: 'spawn', name: null, text: 'documente la API' });
  assert.deepEqual(p('Nuevo agente Hugo: mira los logs'), { type: 'spawn', name: 'Hugo', text: 'mira los logs' });
  assert.deepEqual(p('Nuevo agente llamado Iris'), { type: 'spawn', name: 'Iris', text: '' });
});

test('silencio y selección', () => {
  assert.deepEqual(p('¡Silencio!'), { type: 'silence' });
  assert.deepEqual(p('Cállate, por favor'), { type: 'silence' });
  assert.deepEqual(p('Ana.'), { type: 'select', to: ['Ana'] });
  assert.deepEqual(p('Oye Ana'), { type: 'select', to: ['Ana'] });
  assert.deepEqual(p('  '), { type: 'empty' });
});

test('sin lista de nombres también funciona', () => {
  assert.deepEqual(parseCommand('Ana, revisa', []), { type: 'send', to: null, text: 'Ana, revisa' });
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
  for (const n of ['', '...', '[Música]', '(risas)', 'Subtítulos realizados por la comunidad de Amara.org', '¡Suscríbete!', 'Gracias por ver el video.']) {
    assert.equal(isNoise(n), true, n);
  }
  for (const ok of ['Ana, revisa los tests', 'para', 'Gracias']) assert.equal(isNoise(ok), false, ok);
});
