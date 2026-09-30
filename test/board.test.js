'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createBoard, describeTool } = require('../src/board');

function clock() {
  let t = 1000;
  return { now: () => t, tick: (ms) => { t += ms; } };
}

test('una orden empieza en curso; las siguientes quedan en cola y avanzan en orden', () => {
  const c = clock();
  const b = createBoard({ now: c.now });
  const a = b.add('jarvis', 'planifica el login');
  const q = b.add('jarvis', 'y revisa la API');
  assert.strictEqual(a.status, 'en curso');
  assert.strictEqual(q.status, 'pendiente');
  c.tick(5000);
  const { done, next } = b.finish('jarvis', { ok: true, cost: 0.05, turns: 3, text: 'Hecho.' });
  assert.strictEqual(done.id, a.id);
  assert.strictEqual(done.status, 'hecho');
  assert.strictEqual(done.cost, 0.05);
  assert.strictEqual(next.id, q.id);
  assert.strictEqual(q.status, 'en curso');
  assert.ok(b.busy('jarvis'));
  b.finish('jarvis', { ok: true, cost: 0.02 });
  assert.ok(!b.busy('jarvis'));
  assert.strictEqual(Math.round(b.snapshot().spent.jarvis * 100) / 100, 0.07);
});

test('cada miembro tiene su propia cola', () => {
  const b = createBoard();
  b.add('jarvis', 'a');
  const k = b.add('kitt', 'b');
  assert.strictEqual(k.status, 'en curso');
});

test('los pasos se guardan en la tarea en curso con la salida de cada herramienta', () => {
  const b = createBoard();
  b.add('edith', 'ejecuta los tests');
  b.tool('edith', 'tu1', 'Bash', { command: 'npm test', description: 'Tests' });
  b.tool('edith', 'tu2', 'Edit', { file_path: 'C:/app/src/login.js', old_string: 'a', new_string: 'b' });
  b.toolResult('tu1', [{ type: 'text', text: '17 passing' }], false);
  b.say('edith', 'Todo en verde.');
  const t = b.current('edith');
  assert.strictEqual(t.steps.length, 3);
  assert.strictEqual(t.steps[0].kind, 'validate');
  assert.strictEqual(t.steps[0].ok, true);
  assert.strictEqual(t.steps[0].output, '17 passing');
  assert.strictEqual(t.steps[1].kind, 'edit');
  assert.strictEqual(t.steps[1].after, 'b');
  assert.strictEqual(t.steps[2].kind, 'say');
});

test('un comando que falla queda marcado', () => {
  const b = createBoard();
  b.add('kitt', 'build');
  b.tool('kitt', 'x', 'Bash', { command: 'npm run build' });
  b.toolResult('x', 'Error: falta un módulo', true);
  assert.strictEqual(b.current('kitt').steps[0].ok, false);
});

test('interrumpir y cerrar la sesión cortan las tareas', () => {
  const b = createBoard();
  const a = b.add('tars', 'uno');
  const q = b.add('tars', 'dos');
  b.markInterrupted('tars');
  b.finish('tars', { ok: false });
  assert.strictEqual(a.status, 'interrumpida');
  assert.strictEqual(q.status, 'en curso');
  b.add('tars', 'tres');
  b.closeAll('tars', 'se cerró');
  assert.strictEqual(q.status, 'interrumpida');
  assert.strictEqual(b.tasksOf('tars')[2].status, 'cancelada');
});

test('al volver a abrir la app, lo que estaba a medias no se queda "en curso"', () => {
  const b = createBoard();
  b.add('friday', 'uno');
  b.add('friday', 'dos');
  b.finish('jarvis', { cost: 0.1 });
  const saved = JSON.parse(JSON.stringify(b.serialize()));
  const b2 = createBoard();
  b2.restore(saved);
  const [x, y] = b2.tasksOf('friday');
  assert.strictEqual(x.status, 'interrumpida');
  assert.strictEqual(y.status, 'cancelada');
  assert.strictEqual(b2.snapshot().spent.jarvis, 0.1);
  assert.ok(!b2.busy('friday'));
});

test('limpiar quita solo las terminadas', () => {
  const b = createBoard();
  b.add('jarvis', 'uno');
  b.finish('jarvis', { ok: true });
  b.add('jarvis', 'dos');
  b.clearDone('jarvis');
  assert.deepStrictEqual(b.tasksOf('jarvis').map((t) => t.text), ['dos']);
});

test('describeTool: plan, lectura y búsqueda', () => {
  const p = describeTool('TodoWrite', { todos: [{ content: 'Crear tabla', status: 'completed' }, { content: 'API', status: 'in_progress' }] });
  assert.strictEqual(p.kind, 'plan');
  assert.deepStrictEqual(p.todos.map((t) => t.status), ['completed', 'in_progress']);
  assert.strictEqual(describeTool('Read', { file_path: '/a/b.js' }).file, '/a/b.js');
  assert.strictEqual(describeTool('Grep', { pattern: 'TODO' }).kind, 'search');
  assert.strictEqual(describeTool('Bash', { command: 'git status' }).kind, 'run');
  assert.strictEqual(describeTool('Bash', { command: 'npx vitest run' }).kind, 'validate');
});
