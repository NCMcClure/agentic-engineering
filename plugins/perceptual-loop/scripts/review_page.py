#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""One self-contained HTML page of the open look questions, so the owner judges them in one sitting.

  review_page.py add --id ID --title T --question Q [--context C] --image "label=path" ... [--compare]
                     --option "id=label" ... [--recommend ID] [--default ID] [--evidence "label=value" ...]
                     [--verdict "who=verdict: note" ...] [--replace]
  review_page.py build [--out FILE] [--max-width 1600] [--quality 86] [--link-images] [--title T]
  review_page.py list
  review_page.py apply decisions.json

The queue is .perceptual-loop/decisions/queue.json, a list of items:

  { "id": "paint-red",                      unique; becomes the decision's file name
    "title": "MX5 paint saturation",
    "question": "Which red is right?",       one question, answerable by picking an option
    "context": "what differs and why ...",   free text, shown as written
    "images": [ { "label": "reference", "path": "runs/x/pair.png", "compare": true }, ... ],
                                             paths relative to the project root or absolute; when exactly two images
                                             carry "compare": true the page offers a slider and a blink toggle
    "options": [ { "id": "keep", "label": "Keep the candidate's red" }, ... ],
    "recommended": "keep",                   optional: the agent's own choice, marked on the page
    "defaultOption": "keep",                 optional: what the agent does if the owner does not answer
    "verdicts": [ { "by": "agent-a", "verdict": "more-correct", "note": "..." } ],   optional
    "evidence": [ { "label": "albedo texel", "value": "sRGB 182, 20, 24" } ] }       optional

`build` writes .perceptual-loop/decisions/review.html: images embedded as JPEG data URIs downscaled to --max-width
(Pillow; without it the files are embedded as they are), or referenced in place with --link-images. The page needs
no network. Its Export button gives decisions.json:

  { "decidedAt": "2026-01-10T15:04:05.000Z", "items": [ { "id": "paint-red", "option": "keep", "note": "..." } ] }

("option" is null when the owner wrote a note and picked nothing.) `apply` writes one markdown file per decision to
.perceptual-loop/decisions/<date>-<id>.md (frontmatter id, option, date; body: the question, the choice, the note
verbatim), removes the decided items from the queue and prints what an agent must now do for each.

Exit 0 = done, 2 = usage or environment error.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402

MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}


def decisions_dir(root: Path) -> Path:
    return pl.pl_dir(root) / "decisions"


def load_queue(root: Path) -> list[dict[str, Any]]:
    doc = pl.read_json(decisions_dir(root) / "queue.json", [])
    items = doc.get("items", []) if isinstance(doc, dict) else doc
    if not isinstance(items, list):
        raise pl.PlError("queue.json must be a list of items (see --help)")
    return items


def pairs(values: list[str] | None, what: str) -> list[tuple[str, str]]:
    out = []
    for v in values or []:
        k, sep, rest = v.partition("=")
        if not sep or not k.strip() or not rest.strip():
            raise pl.PlError(f'--{what} "{v}": write it as "{"id" if what == "option" else "label"}=text"')
        out.append((k.strip(), rest.strip()))
    return out


def slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", text).strip("-.") or "item"


# ------------------------------------------------------------------------------------------------------------ images

def image_src(path: Path, max_width: int, quality: int, warn: list[str]) -> str | None:
    """A data URI of the picture, downscaled and JPEG-compressed when Pillow is there."""
    try:
        raw = path.read_bytes()
    except OSError:
        warn.append(f"missing image: {path}")
        return None
    try:
        from PIL import Image
    except ImportError:
        if "pillow" not in " ".join(warn):
            warn.append("pillow is not installed: images are embedded at full size (run with `uv run --no-project`)")
        return f"data:{MIME.get(path.suffix.lower(), 'application/octet-stream')};base64,{base64.b64encode(raw).decode('ascii')}"
    try:
        with Image.open(io.BytesIO(raw)) as im:
            im.load()
            if im.mode in ("RGBA", "LA", "P"):  # JPEG has no alpha: lay the picture on mid grey, where both light and dark read
                rgba = im.convert("RGBA")
                flat = Image.new("RGB", rgba.size, (128, 128, 128))
                flat.paste(rgba, mask=rgba.split()[3])
                im = flat
            else:
                im = im.convert("RGB")
            if im.width > max_width:
                im = im.resize((max_width, max(1, round(im.height * max_width / im.width))), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=quality, optimize=True, subsampling=0)  # no chroma subsampling: colour is the question
    except Exception as e:  # a file that is not a picture
        warn.append(f"unreadable image {path}: {e}")
        return None
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


# -------------------------------------------------------------------------------------------------------------- page

PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
:root {
  --bg: #f6f6f3; --card: #ffffff; --ink: #1c1d1f; --muted: #62666d; --line: #dcdcd6; --accent: #1f5fbf; --accent-ink: #ffffff;
  --soft: #eef2f9; --good: #1d7a46; --stage: #2a2b2e; --radius: 10px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #15161a; --card: #1e2026; --ink: #e9e9ea; --muted: #9a9ea7; --line: #33363e; --accent: #7fb0ff; --accent-ink: #10131a;
          --soft: #262a35; --good: #63c58d; --stage: #0c0d10; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-padding-top: 76px; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
button, input, textarea { font: inherit; color: inherit; }
.bar { position: sticky; top: 0; z-index: 5; background: var(--card); border-bottom: 1px solid var(--line); }
.bar-in { max-width: 1200px; margin: 0 auto; padding: 10px 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.bar h1 { font-size: 17px; margin: 0; font-weight: 650; }
.progress { flex: 1; min-width: 160px; display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 14px; }
.track { flex: 1; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.fill { height: 100%; width: 0; background: var(--good); transition: width .2s; }
.btn { border: 1px solid var(--line); background: var(--card); border-radius: 7px; padding: 6px 12px; cursor: pointer; }
.btn:hover { border-color: var(--accent); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
.btn.on { background: var(--soft); border-color: var(--accent); }
main { max-width: 1200px; margin: 0 auto; padding: 18px 16px 8px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; margin: 0 0 18px; }
.card.active { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 28%, transparent); }
.head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.head h2 { font-size: 20px; margin: 0; flex: 1; min-width: 200px; }
.num { color: var(--muted); font-variant-numeric: tabular-nums; }
.chip { font-size: 12px; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.chip.done { color: var(--good); border-color: var(--good); }
.context { color: var(--muted); white-space: pre-wrap; margin: 8px 0 0; }
.modes { display: flex; gap: 6px; margin: 14px 0 8px; flex-wrap: wrap; align-items: center; font-size: 14px; }
.shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 10px; margin-top: 14px; }
.modes + .shots { margin-top: 0; }
figure { margin: 0; background: var(--stage); border-radius: 8px; overflow: hidden; position: relative; }
figure img { display: block; width: 100%; height: auto; cursor: zoom-in; }
figcaption, .tag { position: absolute; left: 8px; top: 8px; font-size: 12px; padding: 2px 8px; border-radius: 5px; background: rgba(0,0,0,.62); color: #fff; pointer-events: none; }
.tag.right { left: auto; right: 8px; }
.missing { padding: 28px 12px; color: #c9c9c9; font-size: 13px; text-align: center; word-break: break-all; }
.cmp { position: relative; background: var(--stage); border-radius: 8px; overflow: hidden; user-select: none; }
.cmp img { display: block; width: 100%; height: auto; }
.cmp img.top { position: absolute; inset: 0; height: 100%; }
.cmp .rule { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.5); pointer-events: none; }
.cmp input[type=range] { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }
.question { font-size: 18px; font-weight: 600; margin: 16px 0 10px; }
table.evidence { border-collapse: collapse; margin: 0 0 12px; font-size: 14px; }
table.evidence th { text-align: left; font-weight: 500; color: var(--muted); padding: 3px 16px 3px 0; vertical-align: top; }
table.evidence td { padding: 3px 0; font-variant-numeric: tabular-nums; }
.verdicts { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 14px; color: var(--muted); margin: 0 0 12px; }
.verdicts b { color: var(--ink); font-weight: 600; }
fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 6px; }
label.opt { display: flex; gap: 10px; align-items: flex-start; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
label.opt:hover { border-color: var(--accent); }
label.opt.picked { border-color: var(--accent); background: var(--soft); }
label.opt input { margin-top: 5px; accent-color: var(--accent); }
kbd { font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; color: var(--muted); }
.mark { font-size: 12px; color: var(--accent); margin-left: 6px; white-space: nowrap; }
textarea { width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; resize: vertical; }
textarea.note { min-height: 62px; margin-top: 10px; }
.row { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 13px; color: var(--muted); gap: 12px; }
.link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; text-decoration: underline; }
#out { max-width: 1200px; margin: 0 auto 18px; padding: 0 16px; }
#out .card { margin: 0; }
#out textarea { min-height: 220px; font: 13px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
footer { max-width: 1200px; margin: 0 auto; padding: 0 16px 40px; color: var(--muted); font-size: 13px; }
#zoom { position: fixed; inset: 0; z-index: 20; background: rgba(0,0,0,.92); overflow: auto; cursor: zoom-out; display: grid; place-items: center; }
#zoom[hidden] { display: none; }
#zoom img { max-width: 100%; height: auto; }
#zoom.full { display: block; }
#zoom.full img { max-width: none; }
.empty { text-align: center; color: var(--muted); padding: 60px 0; }
</style>
</head>
<body>
<header class="bar"><div class="bar-in">
  <h1>__TITLE__</h1>
  <div class="progress"><div class="track"><div class="fill" id="fill"></div></div><span id="count"></span></div>
  <button class="btn primary" id="export" type="button">Export decisions</button>
</div></header>
<main id="cards"></main>
<section id="out" hidden><div class="card">
  <div class="question" style="margin-top:0">decisions.json</div>
  <p class="context" style="margin:0 0 10px">Downloaded as <b>decisions.json</b>. If the download did not start, copy the text below into a file of that name. Hand it to an agent: <code>review_page.py apply decisions.json</code></p>
  <textarea id="json" readonly spellcheck="false"></textarea>
  <div class="row"><span id="summary"></span><button class="btn" id="copy" type="button">Copy</button></div>
</div></section>
<footer><kbd>j</kbd> <kbd>k</kbd> next / previous question &nbsp; <kbd>1</kbd>&ndash;<kbd>9</kbd> pick an option &nbsp; <kbd>b</kbd> blink two pictures &nbsp; <kbd>Esc</kbd> close a picture. Answers are kept in this browser until you export them. Built __BUILT__.</footer>
<div id="zoom" hidden><img alt=""></div>
<script type="application/json" id="pl-data">__DATA__</script>
<script>
(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('pl-data').textContent);
  const items = data.items;
  let state = {};
  try { state = JSON.parse(localStorage.getItem(data.storageKey) || '{}') || {}; } catch (e) { state = {}; }
  const save = () => { try { localStorage.setItem(data.storageKey, JSON.stringify(state)); } catch (e) { /* private mode: answers live until the tab closes */ } };
  const answer = id => state[id] || (state[id] = { option: null, note: '' });
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  };
  const cards = [];
  let active = 0;

  const zoom = document.getElementById('zoom');
  const openZoom = src => { zoom.firstElementChild.src = src; zoom.classList.remove('full'); zoom.hidden = false; };
  zoom.addEventListener('click', e => { if (e.target === zoom.firstElementChild && !zoom.classList.contains('full')) zoom.classList.add('full'); else zoom.hidden = true; });

  const figure = im => im.src
    ? el('figure', {}, el('img', { src: im.src, alt: im.label, loading: 'lazy', onclick: () => openZoom(im.src) }), el('figcaption', {}, im.label))
    : el('figure', {}, el('div', { class: 'missing' }, 'missing: ' + im.label + ' (' + im.path + ')'));

  function pictures(item) {
    const box = el('div', {});
    const images = item.images || [];
    if (!images.length) return box;
    const pair = images.filter(im => im.compare && im.src);
    const grid = el('div', { class: 'shots' }, ...images.map(figure));
    if (pair.length !== 2 || images.filter(im => im.compare).length !== 2) { box.append(grid); return box; }
    const [a, b] = pair;
    const others = images.filter(im => !pair.includes(im));
    // slider: b underneath, a on top and clipped at the rule
    const top = el('img', { class: 'top', src: a.src, alt: a.label });
    const rule = el('div', { class: 'rule' });
    const range = el('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Position of the divide between ' + a.label + ' and ' + b.label });
    const place = () => { top.style.clipPath = 'inset(0 ' + (100 - range.value) + '% 0 0)'; rule.style.left = 'calc(' + range.value + '% - 1px)'; };
    range.addEventListener('input', place); place();
    const slider = el('div', { class: 'cmp' }, el('img', { src: b.src, alt: b.label }), top, rule, el('span', { class: 'tag' }, a.label), el('span', { class: 'tag right' }, b.label), range);
    // blink: one picture at a time in the same place, so the eye sees what moves
    let showB = false;
    const blinkImg = el('img', { src: a.src, alt: a.label });
    const blinkTag = el('span', { class: 'tag' }, a.label);
    const flip = () => { showB = !showB; const im = showB ? b : a; blinkImg.src = im.src; blinkImg.alt = im.label; blinkTag.textContent = im.label; };
    const blink = el('div', { class: 'cmp', onclick: flip, title: 'Click or press b to switch' }, blinkImg, blinkTag);
    blink.style.cursor = 'pointer';
    const views = { side: grid, slider: el('div', { class: 'shots' }, slider), blink: el('div', { class: 'shots' }, blink) };
    for (const v of ['slider', 'blink']) { views[v].style.gridTemplateColumns = '1fr'; for (const o of others) views[v].append(figure(o)); }
    const buttons = {};
    const show = mode => { for (const [k, v] of Object.entries(views)) { v.hidden = k !== mode; buttons[k].classList.toggle('on', k === mode); } box.dataset.mode = mode; };
    const modes = el('div', { class: 'modes' }, 'Compare:');
    for (const [k, text] of [['side', 'Side by side'], ['slider', 'Slider'], ['blink', 'Blink']]) modes.append(buttons[k] = el('button', { class: 'btn', type: 'button', onclick: () => show(k) }, text));
    box.append(modes, views.side, views.slider, views.blink);
    box.blink = () => { if (box.dataset.mode !== 'blink') show('blink'); else flip(); };
    show('side');
    return box;
  }

  function card(item, index) {
    const a = answer(item.id);
    const status = el('span', { class: 'chip' });
    const node = el('article', { class: 'card', id: 'item-' + index, tabindex: -1 });
    node.append(el('div', { class: 'head' }, el('span', { class: 'num' }, (index + 1) + ' / ' + items.length), el('h2', {}, item.title || item.id), el('span', { class: 'chip' }, item.id), status));
    if (item.context) node.append(el('p', { class: 'context' }, item.context));
    const pics = pictures(item);
    node.append(pics, el('div', { class: 'question' }, item.question || ''));
    if ((item.evidence || []).length) node.append(el('table', { class: 'evidence' }, el('tbody', {}, ...item.evidence.map(e => el('tr', {}, el('th', { scope: 'row' }, e.label), el('td', {}, String(e.value)))))));
    if ((item.verdicts || []).length) node.append(el('div', { class: 'verdicts' }, ...item.verdicts.map(v => typeof v === 'string' ? el('span', {}, el('b', {}, v)) : el('span', {}, (v.by ? v.by + ': ' : ''), el('b', {}, v.verdict || ''), v.note ? ' \u2014 ' + v.note : ''))));
    const labels = [];
    const refresh = () => {
      labels.forEach(([id, label, input]) => { input.checked = a.option === id; label.classList.toggle('picked', a.option === id); });
      const done = !!a.option;
      status.textContent = done ? 'decided' : (a.note.trim() ? 'note only' : 'open');
      status.classList.toggle('done', done);
      progress();
    };
    const fs = el('fieldset', {}, el('legend', { style: 'position:absolute;left:-9999px' }, 'Options'));
    (item.options || []).forEach((o, i) => {
      const input = el('input', { type: 'radio', name: 'opt-' + index, value: o.id, onchange: () => { a.option = o.id; save(); refresh(); } });
      const label = el('label', { class: 'opt' }, input, el('span', {}, i < 9 ? el('kbd', {}, String(i + 1)) : null, ' ', o.label,
        o.id === item.recommended ? el('span', { class: 'mark' }, '\u2605 recommended') : null,
        o.id === item.defaultOption ? el('span', { class: 'mark' }, 'default if unanswered') : null));
      labels.push([o.id, label, input]);
      fs.append(label);
    });
    const note = el('textarea', { class: 'note', placeholder: 'Note for the agents (optional): what you saw, what to do instead', 'aria-label': 'Note' });
    note.value = a.note || '';
    note.addEventListener('input', () => { a.note = note.value; save(); refresh(); });
    node.append(fs, note, el('div', { class: 'row' }, el('span', {}, ''), el('button', { class: 'link', type: 'button', onclick: () => { a.option = null; save(); refresh(); } }, 'clear the choice')));
    node.addEventListener('focusin', () => setActive(index, false));
    node.addEventListener('click', () => setActive(index, false));
    node.pick = n => { const o = (item.options || [])[n]; if (o) { a.option = o.id; save(); refresh(); } };
    node.blink = () => pics.blink && pics.blink();
    refresh();
    return node;
  }

  function progress() {
    const done = items.filter(i => state[i.id] && state[i.id].option).length;
    document.getElementById('fill').style.width = (items.length ? 100 * done / items.length : 0) + '%';
    document.getElementById('count').textContent = done + ' of ' + items.length + ' decided';
  }

  function setActive(i, scroll) {
    if (!cards.length) return;
    active = Math.max(0, Math.min(cards.length - 1, i));
    cards.forEach((c, k) => c.classList.toggle('active', k === active));
    if (scroll) cards[active].scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function exportDecisions() {
    const out = { decidedAt: new Date().toISOString(), items: [] };
    for (const item of items) {
      const a = state[item.id];
      if (a && (a.option || (a.note || '').trim())) out.items.push({ id: item.id, option: a.option || null, note: a.note || '' });
    }
    const text = JSON.stringify(out, null, 2);
    document.getElementById('json').value = text;
    document.getElementById('summary').textContent = out.items.length + ' of ' + items.length + ' questions answered';
    const section = document.getElementById('out');
    section.hidden = false;
    section.scrollIntoView({ block: 'start', behavior: 'smooth' });
    try {
      const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'application/json' }));
      const link = el('a', { href: url, download: 'decisions.json' });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { /* the text is on the page to copy */ }
    return out;
  }

  const main = document.getElementById('cards');
  if (!items.length) main.append(el('p', { class: 'empty' }, 'No open questions.'));
  items.forEach((item, i) => { const c = card(item, i); cards.push(c); main.append(c); });
  progress();
  setActive(0, false);
  document.getElementById('export').addEventListener('click', exportDecisions);
  document.getElementById('copy').addEventListener('click', () => {
    const box = document.getElementById('json');
    const done = () => { document.getElementById('copy').textContent = 'Copied'; };
    box.select();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(box.value).then(done, () => { try { document.execCommand('copy'); done(); } catch (e) {} });
    else { try { document.execCommand('copy'); done(); } catch (e) {} }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { zoom.hidden = true; return; }
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'radio' && t.type !== 'range')))) return;
    if (e.key === 'j') { setActive(active + 1, true); e.preventDefault(); }
    else if (e.key === 'k') { setActive(active - 1, true); e.preventDefault(); }
    else if (e.key === 'b' && cards[active]) cards[active].blink();
    else if (/^[1-9]$/.test(e.key) && cards[active]) { cards[active].pick(Number(e.key) - 1); e.preventDefault(); }
  });
  window.plReview = { state, exportDecisions };  // for a test to read
})();
</script>
</body>
</html>
"""


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build(root: Path, items: list[dict[str, Any]], out: Path, max_width: int, quality: int, link: bool, title: str) -> tuple[list[str], int]:
    warn: list[str] = []
    page_items = []
    for item in items:
        doc = {k: item.get(k) for k in ("id", "title", "question", "context", "recommended", "defaultOption", "verdicts", "evidence")}
        doc["options"] = [{"id": str(o["id"]), "label": str(o.get("label", o["id"]))} for o in item.get("options") or []]
        doc["images"] = []
        for im in item.get("images") or []:
            path = Path(im["path"])
            path = path if path.is_absolute() else root / path
            if link:
                try:
                    rel = os.path.relpath(path.resolve(), out.parent.resolve()).replace(os.sep, "/")
                except ValueError:
                    rel = None  # another drive
                src = (quote(rel) if rel else path.resolve().as_uri()) if path.is_file() else None
                if src is None:
                    warn.append(f"missing image: {path}")
            else:
                src = image_src(path, max_width, quality, warn)
            doc["images"].append({"label": str(im.get("label") or path.stem), "path": str(im["path"]), "compare": bool(im.get("compare")), "src": src})
        page_items.append(doc)
    key = "pl-review:" + hashlib.sha1(str(root.resolve()).encode("utf-8")).hexdigest()[:10]
    data = json.dumps({"storageKey": key, "items": page_items}, ensure_ascii=False)
    data = data.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")  # cannot end the script element
    html = (PAGE.replace("__TITLE__", esc(title)).replace("__BUILT__", time.strftime("%Y-%m-%d %H:%M")).replace("__DATA__", data))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8", newline="\n")
    return warn, len(html.encode("utf-8"))


# ------------------------------------------------------------------------------------------------------------- apply

def decision_markdown(item: dict[str, Any], option: str | None, note: str, date: str) -> str:
    labels = {str(o["id"]): str(o.get("label", o["id"])) for o in item.get("options") or []}
    lines = ["---", f"id: {item['id']}", f"option: {option if option else 'null'}", f"date: {date}", "---", "",
             f"# {item.get('title') or item['id']}", "", "## Question", "", str(item.get("question") or ""), ""]
    if item.get("context"):
        lines += [str(item["context"]), ""]
    lines += ["## Choice", ""]
    if option:
        mark = "" if not item.get("recommended") else (" (the recommendation)" if option == item["recommended"] else
                                                       f" (the recommendation was `{item['recommended']}`)")
        lines += [f"`{option}`: {labels.get(option, '(not one of the options offered)')}{mark}", ""]
    else:
        lines += ["No option chosen: the note is the ruling.", ""]
    lines += ["Offered: " + "; ".join(f"`{k}` {v}" for k, v in labels.items()), "", "## Note", "", note if note.strip() else "(none)", ""]
    return "\n".join(lines)


def apply(root: Path, file: Path) -> tuple[dict[str, Any], str]:
    try:
        doc = json.loads(file.read_text(encoding="utf-8-sig"))
        decided = doc["items"]
        assert isinstance(decided, list)
    except (OSError, ValueError, KeyError, AssertionError, TypeError) as e:
        raise pl.PlError(f"{file}: not a decisions file ({{decidedAt, items: [{{id, option, note}}]}}): {e}") from e
    date = str(doc.get("decidedAt") or "")[:10]
    if not re.fullmatch(r"\d{4}-\d\d-\d\d", date):
        date = time.strftime("%Y-%m-%d")
    queue = load_queue(root)
    by_id = {str(i.get("id")): i for i in queue}
    d = decisions_dir(root)
    written, unknown, text = [], [], []
    for dec in decided:
        item = by_id.get(str(dec.get("id")))
        if item is None:
            unknown.append(str(dec.get("id")))
            continue
        option, note = dec.get("option") or None, str(dec.get("note") or "")
        path = d / f"{date}-{slug(str(item['id']))}.md"
        n = 2
        while path.exists():  # a second ruling on the same question on the same day keeps the first
            path = d / f"{date}-{slug(str(item['id']))}-{n}.md"
            n += 1
        d.mkdir(parents=True, exist_ok=True)
        path.write_text(decision_markdown(item, option, note, date), encoding="utf-8", newline="\n")
        rel = path.relative_to(root).as_posix() if path.is_relative_to(root) else str(path)
        label = next((str(o.get("label")) for o in item.get("options") or [] if str(o["id"]) == option), None)
        if option is None:
            todo = "no option was chosen: the note is the ruling. Read it; if it does not settle the question, queue a sharper one."
        elif label is None:
            todo = f"'{option}' is not one of the options offered: read the note and ask again."
        elif item.get("recommended") and option != item["recommended"]:
            todo = f'the owner chose "{label}", NOT the recommendation ({item["recommended"]}): change course, and undo work that assumed the recommendation.'
        else:
            todo = f'the owner chose "{label}": carry it out.'
        if note.strip() and option is not None:
            todo += " The note adds instructions: read it."
        written.append({"id": item["id"], "option": option, "file": rel, "todo": todo})
        text.append(f"- {item['id']}: {todo}\n    ruling: {rel} (cite it where the work is reported; a ruling is not reopened by a metric)")
    left = [i for i in queue if str(i.get("id")) not in {str(w["id"]) for w in written}]
    if written:
        pl.write_json(d / "queue.json", left)
    for u in unknown:
        text.append(f"- {u}: not in the queue (already applied, or from another page): ignored")
    text.append(f"{len(written)} decision(s) written, {len(left)} question(s) still open"
                + ("; run `review_page.py build` to refresh the page" if left and written else ""))
    return {"written": written, "unknown": unknown, "open": [i.get("id") for i in left]}, "\n".join(text)


# --------------------------------------------------------------------------------------------------------------- cli

def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):  # a Windows console in a legacy code page must not fail on a title's dash
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
    ap = argparse.ArgumentParser(prog="review_page.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, parents=[common])
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("build", parents=[common], help="write the page (the default command)")
    for q in (ap, p):
        q.add_argument("--out", metavar="FILE", help="the page to write (default .perceptual-loop/decisions/review.html)")
        q.add_argument("--max-width", type=int, default=1600, metavar="PX", help="downscale embedded images wider than this (default 1600)")
        q.add_argument("--quality", type=int, default=86, metavar="Q", help="JPEG quality of embedded images (default 86)")
        q.add_argument("--link-images", action="store_true", help="reference the image files instead of embedding them (the page then needs them in place)")
        q.add_argument("--title", default="Look questions for review", help="the page's title")
    p = sub.add_parser("add", parents=[common], help="append a question to the queue")
    p.add_argument("--id", required=True, help="unique id: letters, digits, '-', '_', '.'")
    p.add_argument("--title", required=True)
    p.add_argument("--question", required=True, help="one question the options answer")
    p.add_argument("--context", help="what differs and why it is open")
    p.add_argument("--image", action="append", metavar="LABEL=PATH", help="a picture (repeatable); path relative to the project root or absolute")
    p.add_argument("--compare", action="store_true", help="the first two images show the same view: offer the slider and the blink toggle")
    p.add_argument("--option", action="append", metavar="ID=LABEL", required=True, help="an answer (repeatable, at least two)")
    p.add_argument("--recommend", metavar="ID", help="the option the agent recommends")
    p.add_argument("--default", metavar="ID", help="the option the agent takes if the owner does not answer")
    p.add_argument("--evidence", action="append", metavar="LABEL=VALUE", help="a measured fact with its source (repeatable)")
    p.add_argument("--verdict", action="append", metavar="WHO=VERDICT[: NOTE]", help="a verdict already given (repeatable)")
    p.add_argument("--replace", action="store_true", help="replace the queued item of the same id")
    sub.add_parser("list", parents=[common], help="the queued questions")
    p = sub.add_parser("apply", parents=[common], help="turn an exported decisions.json into decision files and shorten the queue")
    p.add_argument("file")
    a = ap.parse_args(argv)

    try:
        root = pl.find_root()
        d = decisions_dir(root)
        if a.cmd == "add":
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", a.id):
                raise pl.PlError(f"--id '{a.id}': letters, digits, '-', '_', '.' only")
            options = [{"id": k, "label": v} for k, v in pairs(a.option, "option")]
            ids = [o["id"] for o in options]
            if len(options) < 2 or len(set(ids)) != len(ids):
                raise pl.PlError("a question needs at least two options with different ids")
            for flag, value in (("--recommend", a.recommend), ("--default", a.default)):
                if value and value not in ids:
                    raise pl.PlError(f"{flag} {value}: not one of the options ({', '.join(ids)})")
            images = []
            for i, (label, path) in enumerate(pairs(a.image, "image")):
                full = Path(path) if Path(path).is_absolute() else Path.cwd() / path
                if not full.is_file():
                    raise pl.PlError(f"--image {label}: no file {full}")
                full = full.resolve()
                stored = full.relative_to(root.resolve()).as_posix() if full.is_relative_to(root.resolve()) else str(full)
                images.append({"label": label, "path": stored, **({"compare": True} if a.compare and i < 2 else {})})
            if a.compare and len(images) < 2:
                raise pl.PlError("--compare needs two images")
            item: dict[str, Any] = {"id": a.id, "title": a.title, "question": a.question}
            if a.context:
                item["context"] = a.context
            item["images"], item["options"] = images, options
            if a.recommend:
                item["recommended"] = a.recommend
            if a.default:
                item["defaultOption"] = a.default
            if a.evidence:
                item["evidence"] = [{"label": k, "value": v} for k, v in pairs(a.evidence, "evidence")]
            if a.verdict:
                item["verdicts"] = [{"by": k, "verdict": v.partition(":")[0].strip(), **({"note": v.partition(":")[2].strip()} if ":" in v else {})}
                                    for k, v in pairs(a.verdict, "verdict")]
            queue = load_queue(root)
            if any(i.get("id") == a.id for i in queue) and not a.replace:
                raise pl.PlError(f"'{a.id}' is already queued: --replace to change it")
            queue = [i for i in queue if i.get("id") != a.id] + [item]
            pl.write_json(d / "queue.json", queue)
            pl.emit({"queued": a.id, "open": len(queue)}, a.json, f"queued '{a.id}' ({len(queue)} open); `review_page.py build` writes the page")
            return 0
        if a.cmd == "list":
            queue = load_queue(root)
            pl.emit({"items": queue}, a.json, "\n".join(f"{i.get('id')}: {i.get('question')}" for i in queue) or "(the queue is empty)")
            return 0
        if a.cmd == "apply":
            doc, text = apply(root, Path(a.file))
            pl.emit(doc, a.json, text)
            return 0
        queue = load_queue(root)
        for i in queue:
            if not i.get("id") or not i.get("options"):
                raise pl.PlError(f"queue item without id or options: {json.dumps(i)[:120]}")
        out = Path(a.out).resolve() if a.out else d / "review.html"
        warn, size = build(root, queue, out, a.max_width, a.quality, a.link_images, a.title)
        for w in warn:
            print(f"warning: {w}", file=sys.stderr)
        pl.emit({"page": str(out), "items": len(queue), "bytes": size, "warnings": warn}, a.json,
                f"{out}: {len(queue)} question(s), {size / 1024:.0f} KB. Open it in a browser; Export decisions, then `review_page.py apply decisions.json`.")
        return 0
    except pl.PlError as e:
        pl.fail(str(e))


if __name__ == "__main__":
    sys.exit(main())
