(() => {
  if (typeof window === "undefined" || typeof mermaid === "undefined") {
    return;
  }

  // The house tokens, by job. Mermaid computes with colours, so it needs the
  // values and cannot read CSS variables: these mirror --house-* in house.css.
  const TOKENS = {
    light: {
      page: "#f5f5f3", panel: "#ffffff", sunk: "#ebebe8",
      ink: "#171716", ink2: "#5c5c58", line: "#1c1c1b", line2: "#b4b4ae",
      accent: "#ff5a1f", accentSoft: "#ffe9df", onAccent: "#171716",
    },
    dark: {
      page: "#0e0e0f", panel: "#1e1e20", sunk: "#161617",
      ink: "#f1f1ee", ink2: "#a3a39d", line: "#e9e9e5", line2: "#47474a",
      accent: "#ff6b2c", accentSoft: "#3a1c10", onAccent: "#171716",
    },
  };
  const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  // Monochrome: a node is the panel face with a line stroke and ink text, an
  // edge is quiet, a group is the sunk face. Nothing is orange unless the
  // diagram's author marks it (see themeCSS below).
  const themeVariables = (dark) => {
    const t = dark ? TOKENS.dark : TOKENS.light;
    return {
      darkMode: dark,
      background: t.page,
      fontFamily: SANS,
      fontSize: "13px",
      textColor: t.ink,
      titleColor: t.ink,
      lineColor: t.ink2,
      primaryColor: t.panel,
      primaryTextColor: t.ink,
      primaryBorderColor: t.line,
      secondaryColor: t.sunk,
      secondaryTextColor: t.ink,
      secondaryBorderColor: t.line2,
      tertiaryColor: t.sunk,
      tertiaryTextColor: t.ink,
      tertiaryBorderColor: t.line2,
      mainBkg: t.panel,
      nodeBorder: t.line,
      nodeTextColor: t.ink,
      clusterBkg: t.sunk,
      clusterBorder: t.line2,
      edgeLabelBackground: t.page,
      noteBkgColor: t.sunk,
      noteTextColor: t.ink,
      noteBorderColor: t.line2,
      actorBkg: t.panel,
      actorBorder: t.line,
      actorTextColor: t.ink,
      actorLineColor: t.line2,
      signalColor: t.ink2,
      signalTextColor: t.ink,
      labelBoxBkgColor: t.sunk,
      labelBoxBorderColor: t.line2,
      labelTextColor: t.ink,
      loopTextColor: t.ink2,
      activationBkgColor: t.sunk,
      activationBorderColor: t.line2,
      sequenceNumberColor: t.page,
      altBackground: t.sunk,
      errorBkgColor: t.accent,
      errorTextColor: t.onAccent,
    };
  };

  // Hairlines, a small radius, and the one mark an author has: `:::accent` on
  // a node (or `class A,B accent`) gives it the selected look, an accent
  // hairline on the accent tint. Use it for the one thing to look at.
  const themeCSS = (dark) => {
    const t = dark ? TOKENS.dark : TOKENS.light;
    return `
      .node rect, .node polygon, .node circle, .node ellipse, .node path { stroke-width: 1px; }
      .node rect.basic { rx: 6px; ry: 6px; }
      .flowchart-link, .transition, .relation, .messageLine0, .messageLine1 { stroke-width: 1px; }
      .cluster rect { rx: 8px; ry: 8px; stroke-width: 1px; }
      .cluster-label, .edgeLabel { font-family: ${MONO}; font-size: 11px; }
      .edgeLabel, .edgeLabel p, .labelBkg { color: ${t.ink2}; fill: ${t.ink2}; background-color: ${t.page}; }
      .node.accent rect, .node.accent polygon, .node.accent circle, .node.accent ellipse, .node.accent path {
        fill: ${t.accentSoft}; stroke: ${t.accent}; stroke-width: 1.5px;
      }
    `;
  };

  const sources = new WeakMap();

  const captureSources = () => {
    document.querySelectorAll("div.mermaid").forEach((el) => {
      if (!sources.has(el)) {
        sources.set(el, el.textContent);
      }
    });
  };

  const isDark = () => document.documentElement.classList.contains("dark");

  const initWithTheme = () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: themeVariables(isDark()),
      themeCSS: themeCSS(isDark()),
      // A little tighter than Mermaid's defaults, so a diagram of five or six
      // nodes fits the column at its own size instead of being scaled down.
      // Set here, not in CSS: Mermaid measures text before it draws it, and a
      // sequence diagram takes its fonts from these two.
      fontFamily: SANS,
      fontSize: 13,
      flowchart: { padding: 10, nodeSpacing: 36, rankSpacing: 40 },
    });
  };

  const renderAll = async () => {
    captureSources();
    const blocks = Array.from(document.querySelectorAll("div.mermaid"));
    blocks.forEach((el) => {
      const source = sources.get(el);
      if (source !== undefined) {
        el.removeAttribute("data-processed");
        el.textContent = source;
      }
    });
    for (const el of blocks) {
      try {
        await mermaid.run({ nodes: [el] });
      } catch (err) {
        const message =
          err && (err.message || (err.str ? String(err.str) : JSON.stringify(err)));
        console.error("[mermaid-init] render failed:", message, "for source:", sources.get(el));
      }
    }
  };

  const rerender = async () => {
    initWithTheme();
    await renderAll();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", rerender, { once: true });
  } else {
    rerender();
  }

  const htmlEl = document.documentElement;
  let lastDark = isDark();
  new MutationObserver(() => {
    const nowDark = isDark();
    if (nowDark !== lastDark) {
      lastDark = nowDark;
      rerender();
    }
  }).observe(htmlEl, { attributes: true, attributeFilter: ["class"] });
})();
