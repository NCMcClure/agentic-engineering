/*
 * Plan page for the spec site.
 *
 * Renders the plan tree (.plan/plan/) — epics, sprints, and issues with
 * statuses, blockers, acceptance progress, and the next unblocked work — from
 * the read-only /__plan_status__ endpoint served by comments-server.py. The
 * endpoint re-parses the tree on every GET, so this page is live: it polls, and
 * a status flip via plan-status.py shows up within one poll. If the sidecar
 * isn't running (plain `mkdocs serve`, a static build), the page keeps the
 * static fallback text it shipped with — it never breaks.
 *
 * Self-contained IIFE, same shape as spec-comments.js. No build step, no deps.
 * Renders via createElement/textContent only — issue titles are user content.
 * Theming comes from plan-view.css (shadcn variables with fallbacks).
 */
(() => {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const POLL_MS = 15000;
  const STATUSES = ["not-started", "in-progress", "blocked", "done"];

  // Resolve the endpoint against the SAME base the site is served from — not
  // location.origin. Under a path-prefixed proxy (code-server /proxy/<port>/,
  // SSH tunnels) origin drops the prefix; our assets load relatively, so their
  // resolved URL carries it. Same derivation as spec-comments.js. Override with
  // window.PLAN_STATUS_API.
  const resolveApi = () => {
    const el =
      document.querySelector('script[src*="assets/plan-view.js"]') ||
      document.querySelector('link[href*="assets/plan-view.css"]') ||
      document.querySelector('link[href*="assets/"]') ||
      document.querySelector('script[src*="assets/"]');
    const u = el && (el.src || el.href);
    let base = null;
    if (u) {
      const i = u.indexOf("/assets/");
      if (i >= 0) base = u.slice(0, i + 1);
    }
    return window.PLAN_STATUS_API || (base ? base + "__plan_status__" : location.origin + "/__plan_status__");
  };

  // --- tiny DOM helpers ------------------------------------------------------

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const statusBadge = (status) => {
    const safe = STATUSES.includes(status) ? status : "not-started";
    return el("span", "pv-badge pv-badge--" + safe, status || "?");
  };

  const typeBadge = (type) => {
    if (!type) return el("span", "pv-type", "—");
    return el("span", "pv-type pv-type--" + type.toLowerCase(), type);
  };

  // --- rendering ---------------------------------------------------------------

  const renderSummary = (data) => {
    const wrap = el("div", "pv-summary");
    wrap.appendChild(statusBadge(data.status));
    const done = (data.counts.byStatus && data.counts.byStatus.done) || 0;
    const total = data.counts.issues || 0;
    const bar = el("div", "pv-progressbar");
    const fill = el("span");
    fill.style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
    bar.appendChild(fill);
    wrap.appendChild(bar);
    const parts = [done + "/" + total + " issues done"];
    for (const s of ["in-progress", "blocked"]) {
      const n = data.counts.byStatus ? data.counts.byStatus[s] || 0 : 0;
      if (n) parts.push(n + " " + s);
    }
    const gates =
      ((data.counts.byType && data.counts.byType.HITL) || 0) +
      ((data.counts.byType && data.counts.byType.REVIEW) || 0);
    if (gates) parts.push(gates + " human gate" + (gates === 1 ? "" : "s"));
    wrap.appendChild(el("span", "pv-counts", parts.join(" · ")));
    if (data.tracker === "local") {
      wrap.appendChild(el("span", "pv-tracker-note", "local tracker — this page is the board"));
    } else if (data.tracker) {
      wrap.appendChild(el("span", "pv-tracker-note", "tracker: " + data.tracker));
    }
    return wrap;
  };

  const renderNext = (data) => {
    const box = el("div", "pv-next");
    box.appendChild(el("h3", null, "Next up"));
    if (data.next.length === 0) {
      const byStatus = data.counts.byStatus || {};
      const allDone = data.counts.issues > 0 && byStatus.done === data.counts.issues;
      const inFlight = byStatus["in-progress"] || 0;
      let msg = "Nothing unblocked — check the blockers below.";
      if (allDone) msg = "All issues done.";
      else if (inFlight) msg = "Nothing new to start — " + inFlight + " issue" + (inFlight === 1 ? "" : "s") + " in progress.";
      box.appendChild(el("p", "pv-empty", msg));
      return box;
    }
    const list = el("ul");
    for (const n of data.next) {
      const li = el("li");
      li.appendChild(el("span", "pv-node-id", n.id + " "));
      li.appendChild(typeBadge(n.type));
      li.appendChild(document.createTextNode(" " + n.title + " "));
      if (n.type === "HITL" || n.type === "REVIEW") li.appendChild(el("span", "pv-gate", "human gate"));
      li.appendChild(el("br"));
      li.appendChild(el("code", null, n.path)); // issue files aren't served by the site; path, not link
      list.appendChild(li);
    }
    box.appendChild(list);
    return box;
  };

  const renderIssueTable = (sprint, statusById) => {
    const wrap = el("div", "pv-issues-wrap"); // long titles must scroll, not clip the trailing columns
    const table = el("table", "pv-issues");
    const thead = el("thead");
    const hr = el("tr");
    for (const h of ["#", "Type", "Title", "Status", "AC", "Blocked by", "Tracker"]) {
      hr.appendChild(el("th", null, h));
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const i of sprint.issues) {
      const tr = el("tr");
      tr.appendChild(el("td", "pv-node-id", i.id.slice(-2)));
      const tdType = el("td");
      tdType.appendChild(typeBadge(i.type));
      tr.appendChild(tdType);
      tr.appendChild(el("td", null, i.title));
      const tdStatus = el("td");
      tdStatus.appendChild(statusBadge(i.status));
      tr.appendChild(tdStatus);
      tr.appendChild(el("td", null, i.acceptance.total ? i.acceptance.done + "/" + i.acceptance.total : "—"));
      const tdBlocked = el("td");
      if (i.blockedBy.length === 0) {
        tdBlocked.textContent = "—";
      } else {
        for (const b of i.blockedBy) {
          const chip = el("span", "pv-blocker", b);
          if (statusById[b] === "done") chip.className += " pv-blocker--done";
          chip.title = statusById[b] ? "blocker is " + statusById[b] : "unknown blocker";
          tdBlocked.appendChild(chip);
        }
      }
      tr.appendChild(tdBlocked);
      tr.appendChild(el("td", null, i.tracker || "—"));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  };

  const nodeSummary = (node, idText, doneCount, totalCount, childNoun) => {
    const summary = el("summary");
    summary.appendChild(el("span", "pv-node-id", idText));
    summary.appendChild(document.createTextNode(node.title));
    summary.appendChild(statusBadge(node.status));
    summary.appendChild(el("span", "pv-chip", doneCount + "/" + totalCount + " " + childNoun + " done"));
    if (node.rollup && node.rollup !== node.status) {
      const dot = el("span", "pv-drift");
      dot.title = "stored status '" + node.status + "' disagrees with rolled-up '" + node.rollup + "' — run plan-status.py check";
      summary.appendChild(dot);
    }
    return summary;
  };

  const renderTree = (data) => {
    const frag = document.createDocumentFragment();
    const statusById = {};
    for (const e of data.epics)
      for (const s of e.sprints)
        for (const i of s.issues) statusById[i.id] = i.status;

    for (const e of data.epics) {
      const epic = el("details", "pv-epic");
      if (e.status === "in-progress") epic.open = true;
      const sprintsDone = e.sprints.filter((s) => s.status === "done").length;
      epic.appendChild(nodeSummary(e, e.id + " ", sprintsDone, e.sprints.length, "sprints"));
      for (const s of e.sprints) {
        const sprint = el("details", "pv-sprint");
        if (s.status === "in-progress") sprint.open = true;
        const issuesDone = s.issues.filter((i) => i.status === "done").length;
        sprint.appendChild(nodeSummary(s, s.id + " ", issuesDone, s.issues.length, "issues"));
        sprint.appendChild(renderIssueTable(s, statusById));
        epic.appendChild(sprint);
      }
      frag.appendChild(epic);
    }
    return frag;
  };

  const render = (mount, data) => {
    mount.textContent = "";
    if (!data.planExists || data.epics.length === 0) {
      mount.appendChild(el("p", "pv-empty", "No plan tree yet — run /but-first-planning:plan-0-decompose to turn the spec into epics, sprints, and issues."));
    } else {
      mount.appendChild(renderSummary(data));
      mount.appendChild(renderNext(data));
      mount.appendChild(renderTree(data));
    }
    if (data.warnings && data.warnings.length) {
      const box = el("div", "pv-warnings");
      box.appendChild(el("h3", null, "Plan-tree warnings"));
      const list = el("ul");
      for (const w of data.warnings) list.appendChild(el("li", null, w));
      box.appendChild(list);
      mount.appendChild(box);
    }
    mount.appendChild(el("p", "pv-meta", "Read-only view, refreshed every " + POLL_MS / 1000 + "s. Status changes go through plan-status.py, never this page. Generated " + (data.generated || "?") + "."));
  };

  // --- boot --------------------------------------------------------------------

  const boot = () => {
    const mount = document.getElementById("plan-view");
    if (!mount) return; // not the Plan page — stay inert

    const API = resolveApi();
    const fallbackHTML = mount.innerHTML; // the stub's static explanation
    let offline = false;

    const renderOffline = () => {
      if (offline) return; // keep the note, don't re-thrash the DOM
      offline = true;
      mount.innerHTML = fallbackHTML;
      mount.appendChild(el("p", "pv-offline-note", "Retrying every " + POLL_MS / 1000 + "s…"));
    };

    const refresh = () => {
      fetch(API, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then((data) => {
          offline = false;
          render(mount, data);
        })
        .catch(renderOffline);
    };

    refresh();
    setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
