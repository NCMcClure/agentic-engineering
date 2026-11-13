// The studio's dev server. It runs from the plugin's data folder and serves
// figures that live somewhere else: a repo's figures folder, its scratch
// drafts, and the fixtures shipped with the app. Nothing is copied; each
// figure is imported from where it is.
//
// Env, set by `pt studio`:
//   PT_REPO      the repo being worked on (shown, and the lock's owner)
//   PT_FIGURES   that repo's figures folder
//   PT_DRAFTS    that repo's scratch drafts folder; the lock file lives in it
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;
const repo = process.env.PT_REPO ? path.resolve(process.env.PT_REPO) : "";
const figuresDir = process.env.PT_FIGURES ? path.resolve(process.env.PT_FIGURES) : "";
const draftsDir = process.env.PT_DRAFTS ? path.resolve(process.env.PT_DRAFTS) : "";
const fixturesDir = path.join(root, "fixtures");
const lockFile = draftsDir ? path.join(draftsDir, ".studio.lock") : "";

const exists = (p) => { try { return fs.statSync(p); } catch { return null; } };
const folders = (dir) => (exists(dir)?.isDirectory() ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort() : []);
/** A browser import URL for a file outside the server's root. */
const fsUrl = (file) => `/@fs/${file.split(path.sep).join("/").replace(/^\//, "")}`;

/** One figure: a folder holding figure.tsx and model.json. */
function figure(dir, id, kind) {
  const file = path.join(dir, "figure.tsx"), modelFile = path.join(dir, "model.json");
  if (!exists(file)) return null;
  let model = null, problem = null;
  try { model = JSON.parse(fs.readFileSync(modelFile, "utf8")); } catch (e) { problem = exists(modelFile) ? `model.json is not JSON: ${e.message}` : "no model.json"; }
  // A draft says what its view is before it is drawn: the sheet shows that beside the picture.
  let view = null;
  try { view = JSON.parse(fs.readFileSync(path.join(dir, "view.json"), "utf8")); } catch { /* a figure that is not a draft has none */ }
  return { id, kind, dir, url: fsUrl(file), model, problem, view };
}

/** Every figure the studio can show: the repo's, its drafts (round/draft), and the shipped fixtures. */
export function listFigures() {
  const found = [];
  for (const name of folders(figuresDir)) if (name !== "kit") found.push(figure(path.join(figuresDir, name), name, "figure"));
  for (const round of folders(draftsDir)) {
    for (const name of folders(path.join(draftsDir, round))) if (name !== "kit") found.push(figure(path.join(draftsDir, round, name), `${round}/${name}`, "draft"));
  }
  for (const name of folders(fixturesDir)) if (name !== "kit") found.push(figure(path.join(fixturesDir, name), `fixture/${name}`, "fixture"));
  return found.filter(Boolean);
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function api() {
  return {
    name: "picture-this-api",
    configureServer(server) {
      server.middlewares.use("/api", (req, res) => {
        const send = (status, body) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
        // The studio serves source files; only a page on this machine may ask for them.
        if (!LOCAL.test(req.headers.host ?? "")) return send(403, { error: "local requests only" });
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/health") return send(200, { ok: true, app: "picture-this", repo });
        if (url.pathname === "/figures") return send(200, { repo, figures: listFigures() });
        return send(404, { error: "no such endpoint" });
      });

      for (const dir of [figuresDir, draftsDir]) if (dir && exists(dir)) server.watcher.add(dir);
      const changed = (file) => {
        if (/(^|[\\/])(figure\.tsx|model\.json|view\.json)$/.test(file)) server.ws.send({ type: "custom", event: "pt:changed" });
      };
      server.watcher.on("add", changed).on("unlink", changed).on("change", (file) => { if (file.endsWith("model.json") || file.endsWith("view.json")) changed(file); });

      // The lock names the port actually bound, so a second `pt studio` hands
      // back this server's URL instead of starting another.
      const release = () => { try { if (lockFile && JSON.parse(fs.readFileSync(lockFile, "utf8")).pid === process.pid) fs.rmSync(lockFile, { force: true }); } catch { /* gone already */ } };
      server.httpServer?.once("listening", () => {
        const address = server.httpServer.address();
        if (!lockFile || !address || typeof address === "string") return;
        fs.mkdirSync(path.dirname(lockFile), { recursive: true });
        fs.writeFileSync(lockFile, JSON.stringify({ port: address.port, pid: process.pid }) + "\n");
      });
      server.httpServer?.once("close", release);
      process.once("exit", release);
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => { release(); process.exit(0); });
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), api()],
  // A figure outside this folder would otherwise be compiled under whatever
  // tsconfig.json sits above it, and a config that cannot be read stops the
  // server. Stated here, no tsconfig is looked up at all.
  esbuild: { tsconfigRaw: JSON.stringify({ compilerOptions: { jsx: "react-jsx", target: "es2022", useDefineForClassFields: true } }) },
  // Figures live outside this folder and have no node_modules of their own:
  // React is always this app's copy, and there is only one of it. The same
  // goes for the three packages a 3D figure draws with.
  resolve: { dedupe: ["react", "react-dom", "three", "@react-three/fiber", "@react-three/drei"] },
  // Named here so they are bundled before the first figure asks: a package
  // found late makes Vite reload the page, in the middle of a photograph.
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "three", "three/addons/loaders/SVGLoader.js", "@react-three/fiber", "@react-three/drei"] },
  server: {
    host: "127.0.0.1",
    fs: { strict: true, allow: [root, figuresDir, draftsDir].filter(Boolean) },
  },
  clearScreen: false,
});
