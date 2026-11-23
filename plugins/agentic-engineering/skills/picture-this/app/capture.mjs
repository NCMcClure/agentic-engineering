// The camera. Run from the plugin's data folder, where Playwright is
// installed: node capture.mjs <job.json>
//
// A job is { base, scale, result, shots: [{ url, selector, out, colorScheme, viewport }] }.
// Each shot opens its page, waits until every figure on it says its held frame
// is painted, and photographs one element. What was written, and anything a
// page complained about, goes to the job's `result` file as JSON.
//
// A shot may carry its own `scale`, and a `film`: then the page's figure is
// stepped through one loop of its clock and written as a GIF (see film.mjs).
//
// Exit 0 when every shot was taken and no figure failed to draw, 1 when one
// did, 2 when the job or the browser could not be used at all.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// A 3D figure is drawn by software here, never by a graphics card, so a still
// is the same picture on every machine. It is slower: a sheet of 3D beats can
// take most of a minute.
const READY_TIMEOUT_MS = 90000;
const BROWSER_ARGS = ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

/**
 * Every stage on the page has painted its held frame, or a figure has failed.
 * A 3D scene says which frame its canvas last drew (data-pt-paints); the
 * stage waits for it before it says ready, and so does this.
 */
const settled = () => {
  if (document.querySelector("[data-pt-error], .studio-error")) return true;
  const stages = [...document.querySelectorAll("[data-pt-stage]")];
  return stages.length > 0 && stages.every((s) => s.hasAttribute("data-pt-ready")
    && [...s.querySelectorAll("[data-pt-paints]")].every((gl) => gl.getAttribute("data-pt-paints") === s.getAttribute("data-pt-ready")));
};

async function shoot(browser, base, scale, shot) {
  const context = await browser.newContext({
    deviceScaleFactor: shot.scale ?? scale,
    colorScheme: shot.colorScheme ?? "light",
    reducedMotion: "reduce",
    viewport: shot.viewport ?? { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const complaints = [];
  page.on("console", (message) => { if (message.type() === "error") complaints.push(message.text()); });
  page.on("pageerror", (error) => complaints.push(String(error.message ?? error)));
  const done = { out: shot.out, url: shot.url, ok: false, errors: [], console: complaints };
  try {
    await page.goto(base + shot.url, { waitUntil: "load" });
    await page.waitForFunction(settled, null, { timeout: READY_TIMEOUT_MS });
    done.errors = await page.$$eval("[data-pt-error], .studio-error", (found) => found.map((el) => el.textContent.trim()));
    if (!done.errors.length) {
      const target = page.locator(shot.selector).first();
      if (shot.film) Object.assign(done, await (await import("./film.mjs")).film(page, target, shot));
      else {
        fs.mkdirSync(path.dirname(shot.out), { recursive: true });
        await target.screenshot({ path: shot.out, animations: "disabled" });
      }
      const box = await target.boundingBox();
      done.width = Math.round(box.width);
      done.height = Math.round(box.height);
      done.ok = !done.over;
    }
  } catch (error) {
    done.errors.push(String(error.message ?? error).split("\n")[0]);
  } finally {
    await context.close();
  }
  return done;
}

async function main(argv) {
  let job;
  try { job = JSON.parse(fs.readFileSync(argv[0], "utf8")); } catch (error) {
    process.stderr.write(`capture: cannot read the job: ${error.message}\n`);
    return 2;
  }
  let browser;
  try { browser = await chromium.launch({ args: BROWSER_ARGS }); } catch (error) {
    process.stderr.write(`capture: the browser did not start: ${String(error.message ?? error).split("\n")[0]}\n`);
    return 2;
  }
  const shots = [];
  try {
    for (const shot of job.shots) shots.push(await shoot(browser, job.base, job.scale ?? 2, shot));
  } finally {
    await browser.close();
  }
  fs.writeFileSync(job.result, JSON.stringify({ shots }, null, 2) + "\n");
  return shots.every((s) => s.ok) ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
