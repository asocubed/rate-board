// Reads the £ to ₦ rate from each platform with a headless browser and saves rates.json.
// Best effort: if a platform can't be read, its last good rate is kept and marked ok:false.
import { chromium } from 'playwright';
import fs from 'node:fs';

// "from" is the destination currency the site shows by default, so the script can switch it to NGN.
const PLATFORMS = [
  { id: 'lemfi', url: 'https://lemfi.com', from: 'INR' },
  { id: 'oapay', url: 'https://www.oapay.co/', from: 'GHS' },
  { id: 'pesa', url: 'https://www.pesa.co/', from: null },
  { id: 'monieworld', url: 'http://monieworld.com/', from: null },
  { id: 'flutterwave', url: 'https://send.flutterwave.com/', from: null },
];

const MIN = 300, MAX = 10000; // sanity range for ₦ per £1; anything else is treated as a misread
const num = (s) => parseFloat(String(s).replace(/,/g, ''));

// Looks for patterns such as "1 GBP = 1,950.25 NGN" or "£1 = ₦1,950.25".
function findRate(text) {
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
    if (m) { const v = num(m[1]); if (v >= MIN && v <= MAX) return v; }
  }
  return null;
}

// Looks for "fee £1.99" or "Fee: £0.00"; returns null if not found (the page then lets you type it in).
function findFee(text) {
  const t = text.replace(/\s+/g, ' ');
  const m = t.match(/fee[^£\d]{0,20}£\s*([\d.]+)/i) || t.match(/£\s*([\d.]+)\s*(?:transfer\s*)?fee/i);
  if (m) { const v = num(m[1]); if (v >= 0 && v < 50) return v; }
  if (/no fees?|zero fees?|free transfer|0 fee/i.test(t)) return 0;
  return null;
}

// Best effort: switch the destination currency to NGN. Selectors differ per site, so every step is optional.
async function switchToNaira(page, from) {
  const steps = [];
  if (from) steps.push(page.getByText(from, { exact: true }).first());
  steps.push(page.getByText(/^(NGN|Nigeria|Nigerian Naira)$/i).first());
  for (const loc of steps) {
    try { await loc.click({ timeout: 4000 }); await page.waitForTimeout(800); } catch { /* try next */ }
  }
}

async function readPlatform(browser, p) {
  const ctx = await browser.newContext({
    locale: 'en-GB',
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  try {
    await page.goto(p.url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2500);
    await switchToNaira(page, p.from);
    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(`debug/${p.id}.txt`, text);
    await page.screenshot({ path: `debug/${p.id}.png`, fullPage: false });
    const rate = findRate(text);
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
