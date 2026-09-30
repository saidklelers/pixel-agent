'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createPlans, taskPrompt, reportPrompt } = require('../src/plans');

const MEMBERS = [
  { id: 'jarvis', name: 'JARVIS' }, { id: 'friday', name: 'FRIDAY' }, { id: 'tars', name: 'TARS' },
  { id: 'edith', name: 'EDITH' }, { id: 'kitt', name: 'KITT' },
];
const PLAN = {
  titulo: 'Login con Google',
  resumen: 'Permitir entrar con Google',
  tareas: [
    { id: 'api', miembro: 'TARS', tarea: 'Endpoint /auth/google' },
    { id: 'ui', miembro: 'friday', tarea: 'Botón «Entrar con Google»' },
    { id: 'tests', miembro: 'Edith', tarea: 'Tests del login', depende_de: ['api', 'ui'] },
    { id: 'deploy', miembro: 'KITT', tarea: 'Variables en producción', depende_de: ['tests'] },
  ],
};

test('empiezan a la vez las tareas sin dependencias; las demás esperan', () => {
  const p = createPlans();
  const { ok, plan } = p.create(PLAN, MEMBERS);
  assert.ok(ok);
  assert.deepStrictEqual(p.ready(plan).map((t) => t.ref), ['api', 'ui']);
  assert.deepStrictEqual(plan.tasks.map((t) => t.member), ['tars', 'friday', 'edith', 'kitt']);
});

test('el plan avanza al terminar las dependencias y acaba cuando no queda nada', () => {
  const p = createPlans();
  const { plan } = p.create(PLAN, MEMBERS);
  p.markSent(plan, 'api', 'b1');
  p.markSent(plan, 'ui', 'b2');
  assert.strictEqual(p.taskEnded('b1', 'hecho', 'API lista en routes/auth.js').finished, false);
  assert.deepStrictEqual(p.ready(plan).map((t) => t.ref), []); // tests aún espera a ui
  p.taskEnded('b2', 'hecho', 'Botón hecho');
  assert.deepStrictEqual(p.ready(plan).map((t) => t.ref), ['tests']);
  p.markSent(plan, 'tests', 'b3');
  p.taskEnded('b3', 'hecho', '21 tests en verde');
  p.markSent(plan, 'deploy', 'b4');
  const r = p.taskEnded('b4', 'hecho', 'ok');
  assert.strictEqual(r.finished, true);
  assert.strictEqual(plan.status, 'terminado');
  assert.strictEqual(p.taskEnded('otra', 'hecho'), null);
});

test('si una tarea falla, lo que depende de ella queda bloqueado y el plan termina con problemas', () => {
  const p = createPlans();
  const { plan } = p.create(PLAN, MEMBERS);
  p.markSent(plan, 'api', 'b1');
  p.markSent(plan, 'ui', 'b2');
  p.taskEnded('b1', 'error', 'no hay credenciales');
  assert.deepStrictEqual(plan.tasks.map((t) => t.status), ['fallida', 'enviada', 'bloqueada', 'bloqueada']);
  const r = p.taskEnded('b2', 'hecho', 'ok');
  assert.strictEqual(r.finished, true);
  assert.strictEqual(plan.status, 'con problemas');
});

test('el mensaje de la tarea incluye lo que hicieron sus dependencias; el informe, el resumen de todos', () => {
  const p = createPlans();
  const { plan } = p.create(PLAN, MEMBERS, { doc: { path: 'C:/datos/req.pdf', textPath: 'C:/datos/req.pdf.txt' } });
  p.markSent(plan, 'api', 'b1');
  p.markSent(plan, 'ui', 'b2');
  p.taskEnded('b1', 'hecho', 'API lista en routes/auth.js');
  p.taskEnded('b2', 'hecho', 'Botón en Login.jsx');
  const msg = taskPrompt(plan, plan.tasks[2], MEMBERS, 'JARVIS');
  assert.match(msg, /JARVIS te ha asignado/);
  assert.match(msg, /Tests del login/);
  assert.match(msg, /TARS \(api\): API lista en routes\/auth\.js/);
  assert.match(msg, /req\.pdf\.txt/);
  const rep = reportPrompt(plan, MEMBERS);
  assert.match(rep, /INFORME DEL PLAN «Login con Google»/);
  assert.match(rep, /Botón en Login\.jsx/);
});

test('valida el plan: miembros, ciclos, tamaño y rondas', () => {
  const p = createPlans();
  assert.match(p.create({ tareas: [{ miembro: 'ULTRON', tarea: 'x' }] }, MEMBERS).error, /No hay nadie llamado «ULTRON»/);
  assert.match(p.create({ tareas: [] }, MEMBERS).error, /no tiene tareas/);
  assert.match(p.create({ tareas: [
    { id: 'a', miembro: 'TARS', tarea: 'x', depende_de: ['b'] },
    { id: 'b', miembro: 'KITT', tarea: 'y', depende_de: ['a'] },
  ] }, MEMBERS).error, /ciclo/);
  assert.match(p.create({ tareas: Array.from({ length: 13 }, () => ({ miembro: 'TARS', tarea: 'x' })) }, MEMBERS).error, /Demasiadas/);
  assert.match(p.create(PLAN, MEMBERS, { depth: 4 }).error, /rondas/);
  // dependencias que no existen se ignoran
  const { plan } = p.create({ tareas: [{ miembro: 'TARS', tarea: 'x', depende_de: ['nada'] }] }, MEMBERS);
  assert.deepStrictEqual(plan.tasks[0].deps, []);
});

test('cancelar: lo que no ha empezado ya no se envía', () => {
  const p = createPlans();
  const { plan } = p.create(PLAN, MEMBERS);
  p.markSent(plan, 'api', 'b1');
  p.cancel(plan.id);
  assert.deepStrictEqual(plan.tasks.map((t) => t.status), ['enviada', 'cancelada', 'cancelada', 'cancelada']);
  assert.deepStrictEqual(p.ready(plan), []);
  assert.strictEqual(p.taskEnded('b1', 'hecho').finished, false);
});
