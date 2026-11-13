import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { extractAssigned, parseUpdate, validateFact } from './lib/schedule.mjs';

const SOURCE_URL = (process.env.SOURCE_URL || '').trim();
if (!/^https?:\/\//i.test(SOURCE_URL)) {
  console.error('::error::Не задан секрет SOURCE_URL');
  process.exit(1);
}
const CHANNEL = process.env.BROWSER_CHANNEL ?? 'chrome';
const MAX_RETRY = Number(process.env.MAX_RETRY || 4);
const OUT = process.env.OUT_FILE || path.join('data', 'state.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOST = new URL(SOURCE_URL).host;
const redact = (v) => String(v).split(SOURCE_URL).join('***').split(HOST).join('***');
const log = (...a) => console.log('[collect]', ...a.map(redact));

async function launch() {
  const opts = { headless: true, args: ['--disable-blink-features=AutomationControlled'] };
  if (CHANNEL) {
    try {
      return await chromium.launch({ ...opts, channel: CHANNEL });
    } catch (e) {
      log(`канал '${CHANNEL}' недоступен (${e.message.split('\n')[0]}), пробую bundled Chromium`);
    }
  }
  return chromium.launch(opts);
}

async function fetchOnce(context) {
  const page = await context.newPage();
  try {
    await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page
      .waitForFunction(() => window.DisconSchedule && window.DisconSchedule.fact, null, {
        timeout: 45_000,
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
      if (!fact) log(`страница без данных, ${html.length} байт`);
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

const browser = await launch();
const context = await browser.newContext({
  locale: 'uk-UA',
  timezoneId: 'Europe/Kyiv',
  viewport: { width: 1366, height: 900 },
});

let result = null;
let lastReason = 'нет данных';
for (let attempt = 1; attempt <= MAX_RETRY && !result; attempt++) {
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
await browser.close();

if (!result) {
  console.error(redact(`::error::Не удалось получить график после ${MAX_RETRY} попыток: ${lastReason}`));
  process.exit(1);
}

const { fact } = result;
const existing = await readExisting();
const oldFact = existing?.fact;

if (oldFact) {
  const sameData = JSON.stringify(oldFact.data) === JSON.stringify(fact.data);
  const sameUpdate = oldFact.update === fact.update;
  if (sameData && sameUpdate) {
    log(`без изменений (update=${fact.update})`);
    process.exit(0);
  }
  const oldTs = parseUpdate(oldFact.update);
  const newTs = parseUpdate(fact.update);
  if (oldTs !== null && newTs !== null && newTs < oldTs) {
    log(`сайт отдал более старую версию (${fact.update} < ${oldFact.update}), пропускаю`);
    process.exit(0);
  }
}

const now = new Date().toISOString();
const out = {
  lastUpdated: now,
  fact,
  lastUpdateStatus: { status: 'parsed', ok: true, code: 200, message: null, at: now },
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
const tmp = `${OUT}.tmp`;
await fs.writeFile(tmp, JSON.stringify(out, null, 2) + '\n');
await fs.rename(tmp, OUT);
log(`записано: update=${fact.update}`);
