// A looping GIF's arithmetic: which instants of the figure's clock its frames
// are, how long each is shown, and how large a file a README can carry.

/** Past this a GIF is still written, with a warning: a README loads all of it before it moves. */
export const GIF_WARN_BYTES = 5_000_000;
/** GitHub does not show an image larger than this, so a GIF past it is not written. */
export const GIF_MAX_BYTES = 10_000_000;

/**
 * The frames of one whole loop at about `fps` a second: for each, the beat it
 * falls in, how far through that beat (0 to 1), and how long the GIF shows it.
 *
 * The frames divide the loop evenly, so the last one is exactly one step
 * before the first and the loop closes without a jump. A GIF counts time in
 * hundredths of a second, so each delay is rounded to one, and the rounding is
 * carried from frame to frame: the delays add up to the loop's own length and
 * the GIF runs at the figure's speed.
 */
export function loopFrames(beats, fps) {
  const total = beats.reduce((sum, beat) => sum + beat.ms, 0);
  const count = Math.max(1, Math.round((total * fps) / 1000));
  const hundredths = (n) => Math.round((n * total) / count / 10);
  const frames = [];
  let index = 0, start = 0;
  for (let i = 0; i < count; i++) {
    const t = (i * total) / count;
    while (index < beats.length - 1 && t >= start + beats[index].ms) { start += beats[index].ms; index += 1; }
    frames.push({ beat: beats[index].id, at: Number(((t - start) / beats[index].ms).toFixed(6)), delay: (hundredths(i + 1) - hundredths(i)) * 10 });
  }
  return { total, frames };
}

/** A file's size the way a person says it: 512 KB, 6.2 MB. */
export function sizeOf(bytes) {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
