// How Miro sizes the text in a shape, for the lint (does it fit?) and for sizing a card to
// its words before it is drawn. Shape text is Arial, PAD in from each edge, LH of its font
// size per line, and a card renders all its text at its smallest font size. Arial shares
// Helvetica's advance widths, so the widths come from scene-kit's Helvetica table; Miro
// draws a bold line about 8% wider than the table says and a regular one about 2%.

import { tw } from "./scene-kit.mjs";

export const PAD = 8, LH = 1.2;

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Shape content: lines split on <br>, bold lines a little wider; returns [height, widest].
export function measureHtml(html, width, fs) {
  let lines = 0, widest = 0;
  for (const raw of html.replace(/<\/?p>/g, "<br>").split(/<br\s*\/?>/)) {
    const bold = /<(b|strong)>/.test(raw);
    const text = decode(raw.replace(/<[^>]+>/g, ""));
    let line = "";
    const w = (s) => tw(s, fs) * (bold ? 1.08 : 1.02);
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && w(next) > width) { lines++; widest = Math.max(widest, w(line)); line = word; } else line = next;
    }
    lines++; widest = Math.max(widest, w(line));
  }
  return [Math.ceil(lines * fs * LH), Math.ceil(widest)];
}

// The smallest card that holds a bold title and body lines at font size fs, wrapping at
// maxW: { width, height }. The overflow check passes a card of exactly this size. title
// and body take "\n" line breaks; body may also be an array of lines.
export function autosize(title, body = [], { maxW = 320, fs = 14 } = {}) {
  const split = (s) => escape(s).split("\n");
  const rest = (Array.isArray(body) ? body : [body]).flatMap(split);
  const html = [...split(title).map((l) => `<b>${l}</b>`), ...rest].join("<br>");
  const [h, w] = measureHtml(html, maxW - 2 * PAD, fs);
  return { width: w + 2 * PAD, height: h + 2 * PAD };
}
