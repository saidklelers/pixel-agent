'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { TEAM, VOICES, validateCustom, effectiveTeam, systemPromptFor } = require('../src/team');

const others = (id) => TEAM.filter((m) => m.id !== id).map((m) => m.name);

test('sin personalizar, el equipo es el de siempre', () => {
  const eff = effectiveTeam({});
  assert.deepStrictEqual(eff.map((m) => m.name), TEAM.map((m) => m.name));
  assert.ok(eff.every((m) => !m.customized));
});

test('renombrar actualiza el nombre, quita los alias viejos y cambia el nombre en los prompts de todos', () => {
  const v = validateCustom({ name: 'ULTRON' }, others('jarvis'));
  assert.ok(v.ok);
  const eff = effectiveTeam({ jarvis: v.custom });
  const j = eff.find((m) => m.id === 'jarvis');
  assert.strictEqual(j.name, 'ULTRON');
  assert.deepStrictEqual(j.aliases, []);
  assert.match(j.prompt, /Eres ULTRON/);
  // EDITH no nombra a JARVIS, pero el reparto del equipo sí aparece en su prompt
  const edith = eff.find((m) => m.id === 'edith');
  const sp = systemPromptFor(edith, [], eff);
  assert.match(sp, /ULTRON \(Arquitecto/);
  assert.doesNotMatch(sp, /JARVIS/);
});

test('colores, voz y especialidad', () => {
  const v = validateCustom({
    role: 'Móvil (Android e iOS)', look: { accent: '#00FF88', shirt: '#112233' },
    voice: { name: VOICES[0].name, pitch: 9, rate: -12 },
  }, others('friday'));
  assert.ok(v.ok);
  const f = effectiveTeam({ friday: v.custom }).find((m) => m.id === 'friday');
  assert.strictEqual(f.role, 'Móvil (Android e iOS)');
  assert.strictEqual(f.look.accent, '#00ff88');
  assert.strictEqual(f.look.hair, TEAM[1].look.hair); // lo que no cambia se conserva
  assert.strictEqual(f.voice.name, VOICES[0].name);
  assert.strictEqual(f.voice.pitch, '+6st'); // limitado a ±6
  assert.strictEqual(f.voice.rate, '-12%');
});

test('rechaza nombres repetidos, órdenes de voz, colores y voces no válidas', () => {
  assert.strictEqual(validateCustom({ name: 'kitt' }, others('jarvis')).ok, false);
  assert.strictEqual(validateCustom({ name: 'Todos' }, others('jarvis')).ok, false);
  assert.strictEqual(validateCustom({ name: '<script>' }, others('jarvis')).ok, false);
  assert.strictEqual(validateCustom({ look: { accent: 'red' } }, []).ok, false);
  assert.strictEqual(validateCustom({ voice: { name: 'en-US-Evil' } }, []).ok, false);
  // su propio nombre sí puede quedarse
  assert.strictEqual(validateCustom({ name: 'JARVIS' }, others('jarvis')).ok, true);
});
