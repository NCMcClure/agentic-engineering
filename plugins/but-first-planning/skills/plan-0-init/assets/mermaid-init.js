(() => {
  if (typeof window === "undefined" || typeof mermaid === "undefined") {
    return;
  }

  const gruvboxLight = {
    darkMode: false,
    background: "#fbf1c7",
    primaryColor: "#ebdbb2",
    primaryTextColor: "#3c3836",
    primaryBorderColor: "#bdae93",
    secondaryColor: "#d5c4a1",
    secondaryTextColor: "#3c3836",
    secondaryBorderColor: "#928374",
    tertiaryColor: "#f9f5d7",
    tertiaryTextColor: "#3c3836",
    tertiaryBorderColor: "#bdae93",
    lineColor: "#7c6f64",
    textColor: "#3c3836",
    mainBkg: "#ebdbb2",
    noteBkgColor: "#fbf1c7",
    noteTextColor: "#3c3836",
    noteBorderColor: "#bdae93",
    errorBkgColor: "#9d0006",
    errorTextColor: "#fbf1c7",
    nodeBorder: "#d65d0e",
    clusterBkg: "#f9f5d7",
    clusterBorder: "#bdae93",
    edgeLabelBackground: "#fbf1c7",
    titleColor: "#d65d0e",
    activationBkgColor: "#d3869b",
    activationBorderColor: "#8f3f71",
    altBackground: "#d5c4a1",
    fontFamily: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
  };

  const gruvboxDark = {
    darkMode: true,
    background: "#282828",
    primaryColor: "#3c3836",
    primaryTextColor: "#ebdbb2",
    primaryBorderColor: "#665c54",
    secondaryColor: "#504945",
    secondaryTextColor: "#ebdbb2",
    secondaryBorderColor: "#928374",
    tertiaryColor: "#1d2021",
    tertiaryTextColor: "#ebdbb2",
    tertiaryBorderColor: "#665c54",
    lineColor: "#a89984",
    textColor: "#ebdbb2",
    mainBkg: "#3c3836",
    noteBkgColor: "#504945",
    noteTextColor: "#ebdbb2",
    noteBorderColor: "#665c54",
    errorBkgColor: "#fb4934",
    errorTextColor: "#282828",
    nodeBorder: "#fe8019",
    clusterBkg: "#32302f",
    clusterBorder: "#504945",
    edgeLabelBackground: "#282828",
    titleColor: "#fe8019",
    activationBkgColor: "#d3869b",
    activationBorderColor: "#b16286",
    altBackground: "#504945",
    fontFamily: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
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
      themeVariables: isDark() ? gruvboxDark : gruvboxLight,
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
