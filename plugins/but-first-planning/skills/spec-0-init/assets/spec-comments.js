/*
 * Inline commenting for the spec site.
 *
 * Highlight text on any spec page, leave a multi-line comment, and it shows in a
 * rail on the right. Comments auto-save to .plan/spec-comments.json via the
 * companion sidecar (comments-server.py); if that server isn't running they fall
 * back to localStorage so the page never breaks. The spec-4-edit skill reads the
 * JSON and flips each comment's `resolved` flag once it's addressed.
 *
 * Self-contained IIFE, same shape as mermaid-init.js. No build step, no deps.
 * Theming is free: every color comes from the shadcn CSS variables, so light and
 * dark follow the page.
 */
(() => {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // Resolve the comments API against the SAME base the site is served from — not
  // just location.origin. Under a path-prefixed proxy (code-server /proxy/<port>/,
  // SSH tunnels, etc.) origin drops the prefix and the POST misses the server. Our
  // assets load relatively, so their resolved URL carries the prefix: derive the
  // site root from where spec-comments.js/.css actually loaded. Override with
  // window.SPEC_COMMENTS_API.
  let API = null;
  let BASE_PATH = "/"; // the site-root path, including any proxy prefix (e.g. /proxy/8000/)

  // Derive both the API endpoint and the site-root path from where our own assets
  // loaded — that URL carries whatever prefix the proxy adds, so the endpoint hits
  // the server AND we can strip the prefix back off page paths (so specFile stays
  // a clean spec-relative path, not spec/proxy/8000/…).
  const resolveEndpoints = () => {
    const el =
      document.querySelector('script[src*="assets/spec-comments.js"]') ||
      document.querySelector('link[href*="assets/spec-comments.css"]') ||
      document.querySelector('link[href*="assets/"]') ||
      document.querySelector('script[src*="assets/"]');
    const u = el && (el.src || el.href); // .src/.href are absolute, prefix included
    let base = null;
    if (u) {
      const i = u.indexOf("/assets/");
      if (i >= 0) base = u.slice(0, i + 1); // absolute site root, e.g. http://host/proxy/8000/
    }
    BASE_PATH = base ? new URL(base).pathname : "/";
    API = window.SPEC_COMMENTS_API || (base ? base + "__spec_comments__" : location.origin + "/__spec_comments__");
  };

  // Strip the site-root prefix so page identity is proxy-independent.
  const stripBase = (path) => {
    const b = BASE_PATH.replace(/\/$/, "");
    if (b && path.startsWith(b)) path = path.slice(b.length) || "/";
    return normPath(path);
  };
  const POLL_MS = 15000; // re-pull the file so a resolved-flip on disk shows up
  const SAVE_DEBOUNCE_MS = 400;
  const CONTEXT_LEN = 40; // chars of prefix/suffix stored for re-anchoring
  const FALLBACK_KEY = "spec-comments-fallback";

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    comments: [], // ALL comments across every page (the whole file)
    offline: false,
    hideResolved: false,
    container: null,
    saveTimer: null,
    saving: false,
    dirty: false,
  };

  const genId = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  };

  const nowISO = () => new Date().toISOString();

  // ---------------------------------------------------------------------------
  // Where are we? content container + page identity
  // ---------------------------------------------------------------------------

  const findContainer = () => {
    // The shadcn theme markup isn't in-repo; try the usual suspects, most
    // specific first, and fall back to <main>. Never the nav/sidebar.
    const selectors = ["main article", "article.md-content", "[role='main'] article", ".md-content", "[role='main']", "main"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  };

  const normPath = (p) => {
    if (!p) return "/";
    let path = p.split("?")[0].split("#")[0];
    path = path.replace(/index\.html?$/i, "");
    if (!path.startsWith("/")) path = "/" + path;
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return path === "" ? "/" : path;
  };

  const pageKey = () => stripBase(normPath(location.pathname));

  // Best-guess spec source file from the URL. With use_directory_urls a leaf
  // page /a/b/ maps to spec/a/b.md; a section root /a/ *usually* content-free,
  // but if the leaf guess is wrong spec-4-edit disambiguates on disk (index.md).
  const pageSpecFile = () => {
    const path = pageKey();
    if (path === "/") return "spec/index.md";
    const bare = path.replace(/^\//, "");
    if (/\.html?$/i.test(bare)) return "spec/" + bare.replace(/\.html?$/i, ".md"); // use_directory_urls: false
    return "spec/" + bare + ".md";
  };

  // ---------------------------------------------------------------------------
  // Text anchoring (W3C-style TextQuote: exact quote + prefix/suffix context)
  // ---------------------------------------------------------------------------

  const flatText = () => state.container.textContent || "";

  // Character offset of a (node, offset) boundary within the container's flat text.
  const boundaryOffset = (node, offset) => {
    const r = document.createRange();
    r.selectNodeContents(state.container);
    try {
      r.setEnd(node, offset);
    } catch {
      return -1;
    }
    return r.toString().length;
  };

  // Given a flat-text [start, end), find the DOM text-node segments it covers.
  const segmentsForRange = (start, end) => {
    const walker = document.createTreeWalker(state.container, NodeFilter.SHOW_TEXT, null);
    const segments = [];
    let pos = 0;
    let n;
    while ((n = walker.nextNode())) {
      const len = n.nodeValue.length;
      const nodeStart = pos;
      const nodeEnd = pos + len;
      if (nodeEnd > start && nodeStart < end) {
        segments.push({
          node: n,
          localStart: Math.max(0, start - nodeStart),
          localEnd: Math.min(len, end - nodeStart),
        });
      }
      pos = nodeEnd;
      if (pos >= end) break;
    }
    return segments;
  };

  // Collapse every run of whitespace to a single space, keeping a map back to the
  // original character offsets. This is the crux of robust anchoring: a mouse
  // selection's toString() collapses source line-wraps to spaces, but the DOM's
  // textContent keeps the raw newline — so an exact match would miss. We match on
  // the normalized text, then map the hit back to real offsets for wrapping.
  const WS = /\s/;
  const normalizeWithMap = (text) => {
    let norm = "";
    const map = [];
    let inWs = false;
    for (let i = 0; i < text.length; i++) {
      if (WS.test(text[i])) {
        if (!inWs) {
          norm += " ";
          map.push(i);
          inWs = true;
        }
      } else {
        norm += text[i];
        map.push(i);
        inWs = false;
      }
    }
    map.push(text.length); // sentinel: exclusive end of the last char
    return { norm, map };
  };

  const nWs = (s) => s.replace(/\s+/g, " ").trim();

  // Locate the stored quote in the current flat text (whitespace-tolerant), using
  // prefix/suffix to disambiguate repeats. Returns {start, end} raw offsets, or null.
  const locateRange = (c) => {
    if (!c.quote) return null;
    const { norm, map } = normalizeWithMap(flatText());
    const q = nWs(c.quote);
    if (!q) return null;
    const pre = nWs(c.prefix || "");
    const suf = nWs(c.suffix || "");
    let from = 0;
    let best = -1;
    let bestScore = -1;
    while (true) {
      const idx = norm.indexOf(q, from);
      if (idx === -1) break;
      const before = norm.slice(Math.max(0, idx - CONTEXT_LEN), idx);
      const after = norm.slice(idx + q.length, idx + q.length + CONTEXT_LEN);
      let score = 0;
      if (pre && before.endsWith(pre.slice(-CONTEXT_LEN))) score += 2;
      else if (pre && before.includes(pre.slice(-8))) score += 1;
      if (suf && after.startsWith(suf.slice(0, CONTEXT_LEN))) score += 2;
      else if (suf && after.includes(suf.slice(0, 8))) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
      from = idx + 1;
    }
    if (best < 0) return null;
    return { start: map[best], end: map[best + q.length] };
  };

  const wrapSegments = (segments, id, resolved) => {
    // Wrap back-to-front so earlier segments' offsets stay valid after splits.
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i];
      if (s.localStart >= s.localEnd) continue;
      try {
        const range = document.createRange();
        range.setStart(s.node, s.localStart);
        range.setEnd(s.node, s.localEnd);
        const mark = document.createElement("mark");
        mark.className = "spec-comment-highlight" + (resolved ? " resolved" : "");
        mark.dataset.commentId = id;
        range.surroundContents(mark);
      } catch {
        /* overlapping/awkward selection — skip this segment, card still shows */
      }
    }
  };

  const clearHighlights = () => {
    state.container.querySelectorAll("mark.spec-comment-highlight").forEach((m) => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
  };

  const applyHighlights = () => {
    clearHighlights();
    for (const c of pageComments()) {
      // Resolved comments leave no mark in the prose — the subtle highlight is
      // only there to flag an OPEN comment, and disappears once it's resolved.
      if (c.resolved) {
        c._orphaned = false;
        continue;
      }
      const r = locateRange(c);
      c._orphaned = !r;
      if (!r) continue;
      const segs = segmentsForRange(r.start, r.end);
      wrapSegments(segs, c.id, false);
    }
    wireHighlightClicks();
  };

  const wireHighlightClicks = () => {
    state.container.querySelectorAll("mark.spec-comment-highlight").forEach((m) => {
      m.onclick = () => focusCard(m.dataset.commentId);
    });
  };

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  const pageComments = () => {
    const key = pageKey();
    return state.comments.filter((c) => normPath(c.url) === key);
  };

  const load = async () => {
    try {
      const res = await fetch(API, { method: "GET" });
      if (!res.ok) throw new Error("bad status " + res.status);
      const doc = await res.json();
      state.comments = Array.isArray(doc.comments) ? doc.comments : [];
      state.offline = false;
    } catch {
      state.offline = true;
      try {
        state.comments = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]");
      } catch {
        state.comments = [];
      }
    }
    render();
    applyHighlights();
  };

  const persist = () => {
    state.dirty = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    render();
  };

  const flush = async () => {
    state.saving = true;
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments: state.comments }),
      });
      if (!res.ok) throw new Error("bad status " + res.status);
      state.offline = false;
    } catch {
      state.offline = true;
      try {
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(state.comments));
      } catch {
        /* storage full / disabled — nothing more we can do */
      }
    } finally {
      state.saving = false;
      state.dirty = false;
      renderStatus();
    }
  };

  const poll = async () => {
    if (state.dirty || state.saving) return; // don't clobber unsaved local edits
    try {
      const res = await fetch(API, { method: "GET" });
      if (!res.ok) return;
      const doc = await res.json();
      const incoming = Array.isArray(doc.comments) ? doc.comments : [];
      state.offline = false;
      if (JSON.stringify(incoming) !== JSON.stringify(state.comments)) {
        state.comments = incoming;
        render();
        applyHighlights();
      }
    } catch {
      /* server went away — keep showing what we have */
    }
  };

  // ---------------------------------------------------------------------------
  // Comment mutations
  // ---------------------------------------------------------------------------

  const addComment = (anchor, body) => {
    const c = {
      id: genId(),
      specFile: pageSpecFile(),
      url: pageKey(),
      quote: anchor.quote,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      body: body,
      resolved: false,
      created: nowISO(),
      updated: nowISO(),
    };
    state.comments.push(c);
    persist();
    applyHighlights();
    focusCard(c.id);
  };

  const updateComment = (id, patch) => {
    const c = state.comments.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch, { updated: nowISO() });
    persist();
    applyHighlights();
  };

  const deleteComment = (id) => {
    state.comments = state.comments.filter((x) => x.id !== id);
    persist();
    applyHighlights();
  };

  // ---------------------------------------------------------------------------
  // UI — rail
  // ---------------------------------------------------------------------------

  let railEl, listEl, statusEl, root, openBtn, badgeEl;

  const CHAT_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  const buildRail = () => {
    root = document.createElement("div");
    root.className = "spec-comments-root collapsed"; // start closed; the header button opens it

    // The open/close toggle. Mounted into the site header's actions group
    // (see mountOpenButton) so it lives next to the search box and theme toggle;
    // falls back to a floating button only if no header is found.
    openBtn = document.createElement("button");
    openBtn.className = "sc-header-btn";
    openBtn.type = "button";
    openBtn.setAttribute("aria-label", "Toggle comments panel");
    openBtn.innerHTML = CHAT_ICON + '<span class="sc-btn-label">Comments</span>';
    badgeEl = document.createElement("span");
    badgeEl.className = "sc-badge";
    badgeEl.style.display = "none";
    openBtn.appendChild(badgeEl);
    openBtn.onclick = () => root.classList.toggle("collapsed");

    railEl = document.createElement("aside");
    railEl.className = "sc-rail";

    const header = document.createElement("div");
    header.className = "sc-rail-header";
    const title = document.createElement("span");
    title.className = "sc-rail-title";
    title.textContent = "Comments";

    const closeBtn = document.createElement("button");
    closeBtn.className = "sc-rail-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Hide comments panel");
    closeBtn.textContent = "×";
    closeBtn.onclick = () => root.classList.add("collapsed");

    const showResolved = document.createElement("label");
    showResolved.className = "sc-show-resolved";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.onchange = () => {
      state.hideResolved = !cb.checked;
      root.classList.toggle("hide-resolved", state.hideResolved);
      render();
    };
    cb.checked = true;
    showResolved.appendChild(cb);
    showResolved.appendChild(document.createTextNode(" resolved"));

    header.appendChild(title);
    header.appendChild(showResolved);
    header.appendChild(closeBtn);

    statusEl = document.createElement("div");
    statusEl.className = "sc-rail-status";

    listEl = document.createElement("div");
    listEl.className = "sc-rail-list";

    railEl.appendChild(header);
    railEl.appendChild(statusEl);
    railEl.appendChild(listEl);

    root.appendChild(railEl);
    document.body.appendChild(root);
    mountOpenButton();
  };

  // The shadcn header renders client-side; its right-hand actions live in a
  // `.ml-auto` flex group (search + theme toggle). Drop the toggle in beside them.
  const measureHeader = () => {
    const hdr = document.querySelector("header");
    if (hdr) {
      const h = Math.round(hdr.getBoundingClientRect().height);
      root.style.setProperty("--sc-rail-top", h + "px");
    }
  };

  const placeOpenButton = () => {
    const actions = document.querySelector("header .ml-auto");
    if (actions) {
      openBtn.className = "sc-header-btn";
      actions.appendChild(openBtn);
      measureHeader(); // keep the rail docked just under the header
      return true;
    }
    return false;
  };

  const floatOpenButton = () => {
    openBtn.className = "sc-fab"; // fallback: no header found, float bottom-right
    document.body.appendChild(openBtn);
  };

  const mountOpenButton = () => {
    if (placeOpenButton()) return;
    // header hydrates after DOMContentLoaded — watch for it, with a timed fallback
    let tries = 0;
    const obs = new MutationObserver(() => {
      if (placeOpenButton()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setInterval(() => {
      if (placeOpenButton() || ++tries > 25) {
        clearInterval(timer);
        obs.disconnect();
        if (!openBtn.isConnected) floatOpenButton();
      }
    }, 200);
  };

  const renderStatus = () => {
    if (!statusEl) return;
    if (state.offline) {
      statusEl.textContent = "comments server offline — saved locally";
      statusEl.title = "Tried: " + API; // hover to see the endpoint it couldn't reach
      statusEl.className = "sc-rail-status offline";
    } else if (state.saving || state.dirty) {
      statusEl.textContent = "saving…";
      statusEl.className = "sc-rail-status";
    } else {
      statusEl.textContent = "";
      statusEl.className = "sc-rail-status";
    }
  };

  const render = () => {
    if (!listEl) return;
    renderStatus();
    listEl.innerHTML = "";
    const comments = pageComments().slice().sort((a, b) => (a.created < b.created ? -1 : 1));
    const visible = comments.filter((c) => !(state.hideResolved && c.resolved));

    const open = comments.filter((c) => !c.resolved).length;
    if (badgeEl) {
      badgeEl.textContent = String(open);
      badgeEl.style.display = open ? "inline-flex" : "none";
    }

    root.classList.toggle("hide-resolved", state.hideResolved);

    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sc-empty";
      empty.textContent = comments.length
        ? "All comments on this page are resolved."
        : "Select text on the page to leave a comment.";
      listEl.appendChild(empty);
      return;
    }

    for (const c of visible) listEl.appendChild(cardFor(c));
  };

  const cardFor = (c) => {
    const card = document.createElement("div");
    card.className = "sc-card" + (c.resolved ? " resolved" : "") + (c._orphaned ? " orphaned" : "");
    card.dataset.commentId = c.id;

    const quote = document.createElement("div");
    quote.className = "sc-card-quote";
    quote.textContent = c.quote;
    quote.title = "Jump to highlight";
    quote.onclick = () => scrollToHighlight(c.id);

    const body = document.createElement("div");
    body.className = "sc-card-body";
    body.textContent = c.body;

    const meta = document.createElement("div");
    meta.className = "sc-card-meta";
    if (c._orphaned) {
      const warn = document.createElement("span");
      warn.className = "sc-orphan-tag";
      warn.textContent = "text changed";
      warn.title = "The highlighted text was edited or removed; comment kept for reference.";
      meta.appendChild(warn);
    }

    const actions = document.createElement("div");
    actions.className = "sc-card-actions";

    const resolvedLbl = document.createElement("label");
    resolvedLbl.className = "sc-resolve";
    const resolvedCb = document.createElement("input");
    resolvedCb.type = "checkbox";
    resolvedCb.checked = !!c.resolved;
    resolvedCb.onchange = () => updateComment(c.id, { resolved: resolvedCb.checked });
    resolvedLbl.appendChild(resolvedCb);
    resolvedLbl.appendChild(document.createTextNode(" resolved"));

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "sc-link";
    editBtn.textContent = "edit";
    editBtn.onclick = () => inlineEdit(card, c);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "sc-link sc-danger";
    delBtn.textContent = "delete";
    delBtn.onclick = () => {
      if (window.confirm("Delete this comment?")) deleteComment(c.id);
    };

    actions.appendChild(resolvedLbl);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(quote);
    card.appendChild(body);
    if (meta.childNodes.length) card.appendChild(meta);
    card.appendChild(actions);
    return card;
  };

  const inlineEdit = (card, c) => {
    const ta = document.createElement("textarea");
    ta.className = "sc-textarea";
    ta.value = c.body;
    const save = document.createElement("button");
    save.type = "button";
    save.className = "sc-btn sc-btn-primary";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "sc-btn";
    cancel.textContent = "Cancel";
    const row = document.createElement("div");
    row.className = "sc-editor-actions";
    row.appendChild(save);
    row.appendChild(cancel);
    save.onclick = () => updateComment(c.id, { body: ta.value.trim() || c.body });
    cancel.onclick = () => render();
    card.innerHTML = "";
    card.appendChild(ta);
    card.appendChild(row);
    ta.focus();
  };

  const focusCard = (id) => {
    root.classList.remove("collapsed");
    render();
    const card = listEl.querySelector(`.sc-card[data-comment-id="${cssEsc(id)}"]`);
    if (card) {
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      card.classList.add("flash");
      setTimeout(() => card.classList.remove("flash"), 900);
    }
  };

  const scrollToHighlight = (id) => {
    const mark = state.container.querySelector(`mark.spec-comment-highlight[data-comment-id="${cssEsc(id)}"]`);
    if (mark) {
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
      mark.classList.add("flash");
      setTimeout(() => mark.classList.remove("flash"), 900);
    }
  };

  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"));

  // ---------------------------------------------------------------------------
  // UI — selection popover + editor
  // ---------------------------------------------------------------------------

  let addBtn, editor, pendingAnchor;

  const buildSelectionUI = () => {
    addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "sc-add-btn";
    addBtn.textContent = "Add comment";
    addBtn.style.display = "none";
    addBtn.onmousedown = (e) => e.preventDefault(); // keep the selection alive
    addBtn.onclick = openEditorFromSelection;
    document.body.appendChild(addBtn);

    editor = document.createElement("div");
    editor.className = "sc-editor";
    editor.style.display = "none";
    document.body.appendChild(editor);
  };

  const selectionInContainer = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!state.container.contains(range.commonAncestorContainer)) return null;
    const quote = sel.toString();
    if (!quote.trim()) return null;
    return { sel, range, quote };
  };

  const onSelectionSettled = () => {
    const info = selectionInContainer();
    if (!info) {
      if (addBtn) addBtn.style.display = "none";
      return;
    }
    const rect = info.range.getBoundingClientRect();
    addBtn.style.display = "block";
    addBtn.style.top = window.scrollY + rect.top - addBtn.offsetHeight - 8 + "px";
    addBtn.style.left = window.scrollX + rect.left + "px";
  };

  const captureAnchor = (range, quote) => {
    const startOff = boundaryOffset(range.startContainer, range.startOffset);
    const text = flatText();
    let prefix = "";
    let suffix = "";
    if (startOff >= 0) {
      prefix = text.slice(Math.max(0, startOff - CONTEXT_LEN), startOff);
      suffix = text.slice(startOff + quote.length, startOff + quote.length + CONTEXT_LEN);
    }
    return { quote, prefix, suffix };
  };

  const openEditorFromSelection = () => {
    const info = selectionInContainer();
    if (!info) return;
    pendingAnchor = captureAnchor(info.range, info.quote);
    const rect = info.range.getBoundingClientRect();
    addBtn.style.display = "none";
    openEditor(window.scrollY + rect.bottom + 8, window.scrollX + rect.left, (body) => {
      addComment(pendingAnchor, body);
    });
  };

  const openEditor = (top, left, onSave) => {
    editor.innerHTML = "";
    const q = document.createElement("div");
    q.className = "sc-editor-quote";
    q.textContent = pendingAnchor ? pendingAnchor.quote : "";

    const ta = document.createElement("textarea");
    ta.className = "sc-textarea";
    ta.placeholder = "Leave a comment…";

    const row = document.createElement("div");
    row.className = "sc-editor-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "sc-btn sc-btn-primary";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "sc-btn";
    cancel.textContent = "Cancel";
    row.appendChild(save);
    row.appendChild(cancel);

    const close = () => {
      editor.style.display = "none";
      editor.innerHTML = "";
    };
    save.onclick = () => {
      const body = ta.value.trim();
      if (!body) {
        ta.focus();
        return;
      }
      onSave(body);
      close();
    };
    cancel.onclick = close;
    ta.onkeydown = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save.onclick();
      if (e.key === "Escape") close();
    };

    editor.appendChild(q);
    editor.appendChild(ta);
    editor.appendChild(row);
    editor.style.display = "block";
    // clamp within viewport width
    const maxLeft = window.scrollX + document.documentElement.clientWidth - 340;
    editor.style.top = top + "px";
    editor.style.left = Math.min(left, maxLeft) + "px";
    ta.focus();
  };

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  const boot = () => {
    resolveEndpoints();
    try {
      window.__specCommentsApi = API;
    } catch {}
    console.info("[spec-comments] API endpoint:", API, "| base:", BASE_PATH);
    state.container = findContainer();
    buildRail();
    buildSelectionUI();
    load();
    document.addEventListener("mouseup", () => setTimeout(onSelectionSettled, 0));
    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) addBtn && (addBtn.style.display = "none");
    });
    window.addEventListener("resize", measureHeader);
    setInterval(poll, POLL_MS);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
