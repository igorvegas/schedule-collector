import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SCHEMA_VERSION,
  extractAssigned,
  failureStatus,
  okStatus,
  parseUpdate,
  sameFailure,
  validateFact,
} from '../scripts/lib/schedule.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../data/state.json', import.meta.url)));
const html = `<html><script>var DisconSchedule = {};
DisconSchedule.preset = {"a":1};
DisconSchedule.fact = ${JSON.stringify(seed.fact)}; var x = "}{";</script></html>`;

test('extractAssigned достаёт fact и preset', () => {
  assert.deepEqual(extractAssigned(html, 'fact'), seed.fact);
  assert.deepEqual(extractAssigned(html, 'preset'), { a: 1 });
});

test('extractAssigned: строки с фигурными скобками не ломают разбор', () => {
  const h = 'DisconSchedule.fact = {"a":"}{ \\" }","b":{"c":1}}; tail';
  assert.deepEqual(extractAssigned(h, 'fact'), { a: '}{ " }', b: { c: 1 } });
});

test('extractAssigned: заглушка без данных -> null', () => {
  assert.equal(extractAssigned('<html>blocked</html>', 'fact'), null);
});

test('validateFact принимает реальные данные', () => {
  assert.equal(validateFact(seed.fact).ok, true);
});

test('validateFact отклоняет мусор', () => {
  assert.equal(validateFact(null).ok, false);
  assert.equal(validateFact({ update: '1', data: {} }).ok, false);
  const bad = structuredClone(seed.fact);
  const day = Object.values(bad.data)[0];
  for (const g of Object.keys(day)) day[g]['3'] = 'weird';
  for (const d of Object.values(bad.data)) for (const g of Object.keys(d)) d[g]['3'] = 'weird';
  assert.equal(validateFact(bad).ok, false);
});

test('parseUpdate', () => {
  assert.ok(parseUpdate('13.11.2026 21:44') > parseUpdate('13.11.2026 18:39'));
  assert.equal(parseUpdate('мусор'), null);
});

test('failureStatus: ok=false, сообщение обрезается до одной строки', () => {
  const s = failureStatus('первая строка\nвторая', '2026-01-01T00:00:00.000Z');
  assert.equal(s.ok, false);
  assert.equal(s.message, 'первая строка');
  assert.equal(s.at, '2026-01-01T00:00:00.000Z');
  assert.equal(failureStatus('x'.repeat(500)).message.length, 200);
});

test('sameFailure: повтор той же ошибки не считается новым', () => {
  const a = failureStatus('нет fact.update', 't1');
  const b = failureStatus('нет fact.update', 't2');
  assert.equal(sameFailure(a, b), true);
  assert.equal(sameFailure(a, failureStatus('другая', 't3')), false);
  assert.equal(sameFailure(okStatus('t0'), b), false);
  assert.equal(sameFailure(null, b), false);
});

test('okStatus и версия схемы', () => {
  assert.equal(okStatus().ok, true);
  assert.match(SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
});
