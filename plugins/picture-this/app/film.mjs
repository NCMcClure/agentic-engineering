// The film camera: one loop of a figure as a GIF. Loaded by capture.mjs only
// when a shot asks for one, so a still never waits on the encoder.
//
// Nothing is recorded. A figure is a pure function of its clock, so each frame
// is made by holding the clock at that frame's instant, waiting for the stage
// to say it is painted, and photographing it. How fast this machine draws
// changes how long the film takes, never what is in it.
//
// A film shot carries { frames: [{ beat, at, delay }], maxBytes }: where to
// hold the clock for each frame (a beat and a fraction through it), how long
// the GIF shows it (ms, a multiple of 10), and the size past which nothing is
// written.
import fs from "node:fs";
import path from "node:path";

/** Hold the clock at a point in a beat; resolves once the stage says that frame is painted. */
async function hold(page, selector, beat, at) {
  const ready = await page.evaluate(async ([sel, b, a]) => {
    if (!window.__pt) return null;
    await window.__pt.seek(b, a);
    return document.querySelector(sel)?.getAttribute("data-pt-ready") ?? "";
  }, [selector, beat, at]);
  if (ready === null) throw new Error("the figure's stage gave the camera no clock to step (window.__pt)");
  if (!ready.startsWith(`${beat}:`)) throw new Error(`the frame at ${beat} ${at} was never painted`);
}

/** Film `target` into shot.out. Returns { frames, bytes, over }: `over` means the GIF passed maxBytes and was not written. */
export async function film(page, target, shot) {
  const { frames, maxBytes } = shot.film;
  // A caption that wraps to one more line makes its beat taller. Every frame
  // of a GIF is one size, so the stage is held at its tallest beat throughout.
  let tallest = 0;
  for (const beat of new Set(frames.map((f) => f.beat))) {
    await hold(page, shot.selector, beat, 0.5);
    tallest = Math.max(tallest, (await target.boundingBox()).height);
  }
  await target.evaluate((el, height) => { el.style.minHeight = `${height}px`; }, tallest);

  const pictures = [];
  for (const frame of frames) {
    await hold(page, shot.selector, frame.beat, frame.at);
    pictures.push(await target.screenshot({ animations: "disabled" }));
  }

  // The palette is built from these frames. No dithering: the figures are flat
  // colour and hairlines, and dither would put noise in every flat face and
  // weight in the file. A frame that repeats the one before it is folded into it.
  const { default: sharp } = await import("sharp");
  const gif = await sharp(pictures, { join: { animated: true } })
    .gif({ delay: frames.map((f) => f.delay), loop: 0, dither: 0 })
    .toBuffer();
  const over = Boolean(maxBytes) && gif.length > maxBytes;
  if (!over) {
    fs.mkdirSync(path.dirname(shot.out), { recursive: true });
    fs.writeFileSync(shot.out, gif);
  }
  return { frames: frames.length, bytes: gif.length, over };
}
