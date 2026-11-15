// Layout check: goes through every screen of the browser demo, in a large window, the smallest
// window Milo allows (1000 x 600) and the smallest with large text, and reports
//   - anything that scrolls sideways,
//   - buttons and fields cut off by the window or by the box around them,
//   - short labels that break over two lines,
//   - every "?" explanation that does not open, sticks out of the window, or stays after Esc.
//
// Needs the browser version running (`npm run dev`) and Google Chrome (or set CHROME_PATH).
// Run: npm run check:layout
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
if (!CHROME) {
  console.error("Google Chrome was not found. Set CHROME_PATH to its program file.");
  process.exit(1);
}
const URL = process.env.MILO_URL ?? "http://localhost:1420/?demo";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
// A Wednesday morning in the demo week, so every screen has content.
const TARGET = new Date(2026, 10, 11, 10, 20).getTime();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

// Elements that can scroll sideways with content wider than their box.
const sideways = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    const scrollsX = ["auto", "scroll"].includes(cs.overflowX) || el === document.scrollingElement;
    if (scrollsX && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${el.scrollWidth}>${el.clientWidth}`);
  }
  return out;
});
const outside = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".help-pop, .context-menu, .date-pop")) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)) out.push(`${el.className} at ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
  }
  return out;
});

// Buttons and fields cut off by the window or by a box around them, and short labels that
// break over two lines.
const clipped = (page) => page.evaluate(() => {
  const out = [];
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.placeholder || el.tagName).trim().slice(0, 30);
  for (const el of document.querySelectorAll("button, input, select, a, .chip, .task-chip")) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    // The calendar keeps hidden days on both sides for sliding sideways: those are meant to be out of view.
    if (el.closest(".sr-only, [aria-hidden=true], .h-viewport")) continue;
    if (r.right > innerWidth + 1 || r.left < -1) { out.push(`"${name(el)}" outside the window (${Math.round(r.left)}–${Math.round(r.right)})`); continue; }
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible") continue;
      const ar = a.getBoundingClientRect();
      if (r.right > ar.right + 1 || r.left < ar.left - 1) out.push(`"${name(el)}" cut off by .${[...a.classList].join(".")}`);
      break;
    }
  }
  for (const el of document.querySelectorAll(".segmented button, .btn, .nav button, .link")) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    // Only visible text counts, line by line (tops further apart than half a line).
    const tops = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.closest(".sr-only, [aria-hidden=true], kbd")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const x of range.getClientRects()) if (x.width > 1) tops.push(x.top);
    }
    tops.sort((a, b) => a - b);
    const lines = tops.filter((t, i) => i === 0 || t - tops[i - 1] > 8).length;
    if (lines > 1) out.push(`"${name(el)}" breaks over ${lines} lines`);
  }
  return out;
});

async function check(page, where) {
  (await sideways(page)).forEach((p) => problems.push(`${where}: scrolls sideways: ${p}`));
  (await clipped(page)).forEach((p) => problems.push(`${where}: ${p}`));
  // With a dialog open, only its own "?"s can be reached.
  const sel = (await page.$("dialog[open]")) ? "dialog[open] .help-btn" : ".help-btn";
  const n = await page.$$eval(sel, (bs) => bs.length);
  for (let i = 0; i < n; i++) {
    const b = (await page.$$(sel))[i];
    if (!b) continue;
    await b.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await wait(150);
    await b.click();
    await wait(200);
    const label = await b.evaluate((el) => el.getAttribute("aria-label"));
    if (!(await page.$(".help-pop"))) problems.push(`${where}: "${label}" did not open`);
    (await outside(page)).forEach((p) => problems.push(`${where}: "${label}" outside the window: ${p}`));
    (await sideways(page)).forEach((p) => problems.push(`${where}: "${label}" makes it scroll sideways: ${p}`));
    await page.keyboard.press("Escape");
    await wait(120);
    if (await page.$(".help-pop")) problems.push(`${where}: "${label}" did not close with Esc`);
  }
  return n;
}

for (const [w, h, textSize] of [[1440, 900, "default"], [1000, 600, "default"], [1000, 600, "large"]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.evaluateOnNewDocument((target, textSize) => {
    const offset = target - Date.now(); const Real = Date;
    class Fake extends Real { constructor(...a) { a.length ? super(...a) : super(Real.now() + offset); } static now() { return Real.now() + offset; } }
    window.Date = Fake;
    localStorage.setItem("milo-ui", JSON.stringify({ state: { view: "today", prefs: { setupDone: true, lastSeenVersion: "9.9.9", textSize }, settingsOpen: ["appearance", "today", "calendar", "import", "archive", "data"] }, version: 0 }));
  }, TARGET, textSize);
  await page.goto(URL, { waitUntil: "networkidle0" });
  await wait(800);
  const key = async (k) => { await page.keyboard.down("Meta"); await page.keyboard.press(k); await page.keyboard.up("Meta"); await wait(600); };
  const size = `${w}x${h}${textSize === "large" ? " large text" : ""}`;
  const counts = {};
  counts.today = await check(page, `${size} Today`);
  // "What do you want to do today?"
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "+ From my to-dos")?.click());
  await wait(500);
  counts.picker = await check(page, `${size} Today picker`);
  await page.keyboard.press("Escape");
  await wait(300);
  await key("2"); counts.calendar = await check(page, `${size} Calendar`);
  // An event open beside the calendar, set to repeat (the Repeat field has a "?").
  await page.evaluate(() => [...document.querySelectorAll("[class*=event]")].find((e) => e.textContent.startsWith("Chemistry lab"))?.click());
  await wait(500);
  await page.evaluate(() => { const s = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "weekly")); if (s) { s.value = "weekly"; s.dispatchEvent(new Event("change", { bubbles: true })); } });
  await wait(500);
  counts.event = await check(page, `${size} Calendar event`);
  await page.keyboard.press("Escape");
  await key("3");
  counts.tasks = await check(page, `${size} Tasks overview`);
  // The Today list with a to-do open beside it.
  await page.evaluate(() => [...document.querySelectorAll(".tile")].find((b) => b.textContent.startsWith("Today"))?.click());
  await wait(400);
  await page.evaluate(() => [...document.querySelectorAll(".todo-title")].find((e) => e.textContent.trim() === "Lab report titration")?.click());
  await wait(500);
  counts.todayList = await check(page, `${size} Tasks › Today, with a to-do open`);
  // Every to-do in the table, the same to-do open.
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "All to-dos")?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll(".t-title")].find((e) => e.textContent.trim() === "Lab report titration")?.click());
  await wait(500);
  counts.allTodos = await check(page, `${size} All to-dos`);
  await key("4"); counts.insights = await check(page, `${size} Insights`);
  await key("5"); counts.reminders = await check(page, `${size} Reminders`);
  // A space of each kind: a course, a list, and time only.
  for (const name of ["Chemistry", "Errands", "Work"]) {
    await page.evaluate((n) => [...document.querySelectorAll(".space-open")].find((e) => e.textContent.trim() === n)?.click(), name);
    await wait(500);
    counts[name] = await check(page, `${size} Space ${name}`);
  }
  await key(","); counts.settings = await check(page, `${size} Settings (all open)`);
  // The welcome guide, every step.
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Open the guide")?.click());
  await wait(600);
  for (let step = 0; step < 8; step++) {
    counts[`guide${step + 1}`] = await check(page, `${size} Guide step ${step + 1}`);
    const moved = await page.evaluate(() => { const b = document.querySelector("dialog[open] .setup-foot .btn.primary"); if (!b || /open today/i.test(b.textContent)) return false; b.click(); return true; });
    if (!moved) break;
    await wait(500);
  }
  console.log(size, JSON.stringify(counts));
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "No problems found.");
process.exit(problems.length ? 1 : 0);
