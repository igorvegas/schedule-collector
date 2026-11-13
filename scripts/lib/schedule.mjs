export const KNOWN_STATES = new Set([
  'yes', 'no', 'maybe', 'first', 'second', 'mfirst', 'msecond',
]);

export function extractAssigned(html, name) {
  const re = new RegExp(`DisconSchedule\\.${name}\\s*=\\s*`);
  const m = re.exec(html);
  if (!m) return null;
  const start = html.indexOf('{', m.index + m[0].length - 1);
  if (start < 0 || start > m.index + m[0].length + 2) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function validateFact(fact) {
  if (!fact || typeof fact !== 'object') return { ok: false, reason: 'fact отсутствует' };
  if (typeof fact.update !== 'string' || !fact.update.trim()) {
    return { ok: false, reason: 'нет fact.update' };
  }
  const data = fact.data;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'нет fact.data' };
  let goodGroups = 0;
  for (const [ts, groups] of Object.entries(data)) {
    if (!/^\d+$/.test(ts) || !groups || typeof groups !== 'object') continue;
    for (const [g, hours] of Object.entries(groups)) {
      if (!/^\d+(\.\d+)*$/.test(g.replace('GPV', '').trim())) continue;
      const arr = Array.isArray(hours)
        ? hours.map(String)
        : Array.from({ length: 24 }, (_, i) => String(hours?.[String(i + 1)] ?? ''));
      if (arr.length === 24 && arr.every((s) => KNOWN_STATES.has(s))) goodGroups++;
    }
  }
  if (!goodGroups) return { ok: false, reason: 'нет ни одной очереди с 24 известными статусами' };
  return { ok: true, goodGroups };
}

export function parseUpdate(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/.exec(String(s ?? '').trim());
  if (!m) return null;
  const [, d, mo, y, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}
