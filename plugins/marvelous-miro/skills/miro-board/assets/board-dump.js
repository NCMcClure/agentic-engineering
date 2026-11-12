// Runs inside the Miro board tab (not Node): dumps what the live board actually draws,
// which the MCP read does not return: each connector's routed points and its caption
// positions, and each card's text height measured in the browser at Miro's padding.
// `live.mjs prepare` copies it into the project and prints the evaluate_script call
// (sourcePath this copy, filePath the dump); `live.mjs check` lints the dump.
async () => {
  const PAD = 8, LH = 1.2;
  const info = cmd.board.api.getAllDomainWidgetsInfo();
  const sdk = new Map((await miro.board.get()).map((w) => [String(w.id), w]));
  const cv = document.createElement("canvas").getContext("2d");
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden";
  document.body.appendChild(host);
  const measure = (html, width, size) => {
    const d = document.createElement("div");
    d.style.cssText = `width:${width}px;font-family:Arial;font-size:${size}px;line-height:${LH};overflow-wrap:break-word;white-space:normal;margin:0;padding:0`;
    d.innerHTML = html.replace(/<p>/g, "<div>").replace(/<\/p>/g, "</div>");
    host.appendChild(d);
    const out = [Math.round(d.getBoundingClientRect().height), Math.round(d.scrollWidth)];
    d.remove();
    return out;
  };
  const out = [];
  for (const w of info) {
    const s = sdk.get(String(w.id)) || {};
    const o = { id: String(w.id), type: w.type, b: w.bounds, pts: w.mediumPoints || null, parentId: s.parentId ? String(s.parentId) : null };
    if (s.type === "shape") {
      o.shape = s.shape; o.content = s.content; o.fs = +s.style.fontSize;
      if (s.content) o.meas = measure(s.content, s.width - 2 * PAD, o.fs);
    }
    if (s.type === "text") { o.content = s.content; o.fs = +s.style.fontSize; o.textH = measure(s.content, s.width, o.fs)[0]; }
    if (s.type === "connector") {
      o.start = s.start && String(s.start.item); o.end = s.end && String(s.end.item);
      o.startSide = s.start && s.start.snapTo; o.endSide = s.end && s.end.snapTo; o.shape = s.shape;
      o.aligned = ((s.style && s.style.textOrientation) || "aligned") === "aligned";
      o.captions = (s.captions || []).map((c) => {
        const fs = (s.style && s.style.fontSize) || 14;
        cv.font = `${fs}px Arial`;
        return { text: c.content.replace(/<[^>]+>/g, ""), position: c.position ?? 0.5, tav: c.textAlignVertical || "middle", w: Math.round(cv.measureText(c.content.replace(/<[^>]+>/g, "")).width), fs };
      });
    }
    out.push(o);
  }
  host.remove();
  return out;
}
