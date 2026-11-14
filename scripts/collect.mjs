import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import {
  SCHEMA_VERSION,
  extractAssigned,
  failureStatus,
  okStatus,
  parseUpdate,
  sameFailure,
  validateFact,
} from './lib/schedule.mjs';

const SOURCE_URL = (process.env.SOURCE_URL || '').trim();
if (!/^https?:\/\//i.test(SOURCE_URL)) {
  console.error('::error::Не задан секрет SOURCE_URL');
  process.exit(1);
}
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const MIN_HTML_BYTES = Number(process.env.MIN_HTML_BYTES || 1500);
const MAX_RETRY = Number(process.env.MAX_RETRY || 4);
const OUT = process.env.OUT_FILE || path.join('data', 'state.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOST = new URL(SOURCE_URL).host;
const redact = (v) => String(v).split(SOURCE_URL).join('***').split(HOST).join('***');
const log = (...a) => console.log('[collect]', ...a.map(redact));

async function launch() {
  return chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

async function fetchOnce(context) {
  const page = await context.newPage();
  try {
    await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page
      .waitForFunction(() => window.DisconSchedule && window.DisconSchedule.fact, null, {
        timeout: 15_000,
      })
      .catch(() => {});
    let fact = null;
    try {
      ({ fact } = await page.evaluate(() => {
        const d = window.DisconSchedule || {};
        return JSON.parse(JSON.stringify({ fact: d.fact ?? null }));
      }));
    } catch {}
    if (!fact) {
      const html = await page.content();
      fact = extractAssigned(html, 'fact');
      if (!fact) {
        const markers = html.includes('DisconSchedule.fact') ? 'маркер есть' : 'маркера нет';
        const small = html.length < MIN_HTML_BYTES ? ', слишком короткий ответ' : '';
        log(`страница без данных, ${html.length} байт, ${markers}${small}`);
      }
    }
    return { fact };
  } finally {
    await page.close();
  }
}

async function readExisting() {
  try {
    return JSON.parse(await fs.readFile(OUT, 'utf8'));
  } catch {
    return null;
  }
}

let browser = null;
let context = null;
let result = null;
let lastReason = 'нет данных';
try {
  browser = await launch();
  context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
    viewport: { width: 1366, height: 900 },
  });
} catch (e) {
  lastReason = `браузер не запущен: ${e.message.split('\n')[0]}`;
}

for (let attempt = 1; context && attempt <= MAX_RETRY && !result; attempt++) {
  try {
    log(`попытка ${attempt}/${MAX_RETRY}`);
    const { fact } = await fetchOnce(context);
    const v = validateFact(fact);
    if (v.ok) result = { fact };
    else lastReason = v.reason;
  } catch (e) {
    lastReason = e.message.split('\n')[0];
  }
  if (!result) {
    log(`неудача: ${lastReason}`);
    if (attempt < MAX_RETRY) await sleep(2000 * attempt + Math.random() * 500);
  }
}
await browser?.close();

async function writeOut(obj) {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n');
  await fs.rename(tmp, OUT);
}

const existing = await readExisting();

if (!result) {
  const message = redact(lastReason);
  console.warn(`::warning::Не удалось получить график после ${MAX_RETRY} попыток: ${message}`);
  if (existing?.fact) {
    const status = failureStatus(message);
    if (!sameFailure(existing.lastUpdateStatus, status)) {
      await writeOut({ ...existing, lastUpdateStatus: status });
      log('записан статус ошибки');
    }
  }
  process.exit(0);
}

const { fact } = result;
const oldFact = existing?.fact;
const recovered = existing?.lastUpdateStatus?.ok === false;
const hasMeta = existing?.meta?.schemaVersion === SCHEMA_VERSION;
const now = new Date().toISOString();
let changed = true;

if (oldFact) {
  const sameData = JSON.stringify(oldFact.data) === JSON.stringify(fact.data);
  const sameUpdate = oldFact.update === fact.update;
  const oldTs = parseUpdate(oldFact.update);
  const newTs = parseUpdate(fact.update);
  const older = oldTs !== null && newTs !== null && newTs < oldTs;
  changed = !(sameData && sameUpdate) && !older;
  if (older) log(`сайт отдал более старую версию (${fact.update} < ${oldFact.update}), пропускаю`);
  if (!changed && !recovered && hasMeta) {
    log(`без изменений (update=${fact.update})`);
    process.exit(0);
  }
}

const base = changed || !existing ? { lastUpdated: now, fact } : { lastUpdated: existing.lastUpdated, fact: oldFact };
await writeOut({
  ...base,
  lastUpdateStatus: okStatus(now),
  meta: { schemaVersion: SCHEMA_VERSION },
});
log(
  changed
    ? `записано: update=${fact.update}`
    : recovered
      ? `статус восстановлен (update=${oldFact.update})`
      : `добавлена версия формата (update=${oldFact.update})`,
);
