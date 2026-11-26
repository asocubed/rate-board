// Reads the £ to ₦ rate from each platform with a headless browser and saves rates.json.
// Best effort: if a platform can't be read, its last good rate is kept and marked ok:false.
import { chromium } from 'playwright';
import fs from 'node:fs';

// steps: things to click, in order, to get the calculator onto £ -> ₦. Each step is optional (failures are ignored).
// click: text to click (exact match). last: use the last match on the page. pick: option to choose from the menu that opens.
const PLATFORMS = [
  { id: 'lemfi', url: 'https://lemfi.com', steps: [
    { click: 'USD', pick: /^GBP\b/ },
    { click: 'INR', pick: /^(NGN|Nigeria)\b/ },
  ] },
  { id: 'oapay', url: 'https://www.oapay.co/', steps: [
    { click: 'GHS', last: true, pick: /^(NGN|Nigeria)\b/ },
  ] },
  { id: 'pesa', url: 'https://www.pesa.co/', invert: true, steps: [
    { click: 'CAD', last: true, pick: /^(GBP|United Kingdom)\b/ },
  ] },
  { id: 'monieworld', url: 'http://monieworld.com/', steps: [] },
  { id: 'flutterwave', url: 'https://send.flutterwave.com/', steps: [] },
];

const MIN = 300, MAX = 10000; // sanity range for ₦ per £1; anything else is treated as a misread
const num = (s) => parseFloat(String(s).replace(/,/g, ''));

// Looks for "1 GBP = 1,950.25 NGN" or "£1 = ₦1,950.25". With invert, a tiny value (₦1 expressed in £) is flipped.
function findRate(text, invert) {
  const t = text.replace(/\s+/g, ' ');
  const patterns = [
    /1\s*GBP\s*=\s*([\d,]+(?:\.\d+)?)\s*NGN/i,
    /£\s*1\s*=\s*₦\s*([\d,]+(?:\.\d+)?)/,
    /GBP\s*1\s*=\s*NGN\s*([\d,]+(?:\.\d+)?)/i,
    /1\s*GBP\s*[=≈~:]\s*₦\s*([\d,]+(?:\.\d+)?)/i,
    /NGN\s*([\d,]+(?:\.\d+)?)\s*\/\s*(?:1\s*)?GBP/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (!m) continue;
    let v = num(m[1]);
    if (invert && v > 0 && v < 0.05) v = 1 / v;
    if (v >= MIN && v <= MAX) return v;
  }
  return null;
}

// Looks for "Fee £1.99", "Transactions fee $0.00" or "Fee FREE"; null if not found.
function findFee(text) {
  const t = text.replace(/\s+/g, ' ');
  if (/fees?\s*:?\s*free\b/i.test(t) || /(no|zero|0)\s*(transfer\s*)?fees?\b/i.test(t)) return 0;
  const m = t.match(/fees?[^£$\d]{0,25}[£$]\s*([\d.]+)/i) || t.match(/[£$]\s*([\d.]+)\s*(?:transfer\s*)?fee/i);
  if (m) { const v = num(m[1]); if (v >= 0 && v < 50) return v; }
  return null;
}

async function dismissCookies(page) {
  for (const name of [/reject non-essential/i, /necessary only/i, /accept all/i, /^accept$/i, /^got it$/i]) {
    try { await page.getByRole('button', { name }).first().click({ timeout: 1500 }); await page.waitForTimeout(500); return; } catch { /* next */ }
  }
}

async function runSteps(page, p) {
  let i = 0;
  for (const s of p.steps) {
    i++;
    try {
      let loc = page.getByText(s.click, { exact: true }).locator('visible=true');
      loc = s.last ? loc.last() : loc.first();
      await loc.click({ timeout: 5000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `debug/${p.id}-step${i}-menu.png` });
      await page.getByText(s.pick).locator('visible=true').first().click({ timeout: 5000 });
      await page.waitForTimeout(1500);
    } catch (e) {
      fs.appendFileSync(`debug/${p.id}.log`, `step ${i} (${s.click}): ${String(e.message || e).split('\n')[0]}\n`);
    }
  }
}

async function readPlatform(browser, p) {
  const ctx = await browser.newContext({
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  try {
    await page.goto(p.url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2500);
    await dismissCookies(page);
    await runSteps(page, p);
    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(`debug/${p.id}.txt`, text);
    await page.screenshot({ path: `debug/${p.id}.png` });
    const rate = findRate(text, p.invert);
    if (!rate) return { ok: false, error: 'Could not find a £ to ₦ rate on the page' };
    return { ok: true, rate, fee: findFee(text) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  } finally {
    await ctx.close();
  }
}

fs.mkdirSync('debug', { recursive: true });
let previous = {};
try { previous = JSON.parse(fs.readFileSync('rates.json', 'utf8')).platforms || {}; } catch { /* first run */ }

const browser = await chromium.launch();
const now = new Date().toISOString();
const platforms = {};
for (const p of PLATFORMS) {
  const old = previous[p.id] || {};
  const r = await readPlatform(browser, p);
  if (r.ok) platforms[p.id] = { ok: true, rate: r.rate, fee: r.fee, fetchedAt: now };
  else platforms[p.id] = { ok: false, error: r.error, rate: old.rate ?? null, fee: old.fee ?? null, fetchedAt: old.fetchedAt ?? null };
  console.log(p.id, platforms[p.id]);
}
await browser.close();
fs.writeFileSync('rates.json', JSON.stringify({ updatedAt: now, platforms }, null, 2) + '\n');
