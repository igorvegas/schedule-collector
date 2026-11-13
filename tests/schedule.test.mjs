import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractAssigned, parseUpdate, validateFact } from '../scripts/lib/schedule.mjs';

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
