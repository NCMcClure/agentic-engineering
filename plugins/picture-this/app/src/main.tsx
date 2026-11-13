// The studio: three pages over the same figures.
//   /        the gallery: every figure, live
//   /frame   one figure and nothing else, for capture
//   /sheet   one figure's beats side by side, as stills
// A figure is imported from where it lives (a repo's figures folder, a draft
// round, a fixture) and given its props from the query string.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./studio.css";
import { Component, StrictMode, Suspense, lazy, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { createRoot } from "react-dom/client";

type Model = { title?: string; claim?: string; beats?: { id: string; title?: string; rest?: boolean }[]; hero?: { beat: string; at?: number } };
type Entry = { id: string; kind: "figure" | "draft" | "fixture"; dir: string; url: string; model: Model | null; problem: string | null };
type FigureProps = {
  theme?: "light" | "dark";
  beat?: string;
  at?: number;
  still?: boolean;
  audience?: "plain" | "technical";
  captions?: boolean;
  controls?: boolean;
};

const query = new URLSearchParams(location.search);
const flag = (name: string, fallback: boolean) => (query.has(name) ? query.get(name) !== "0" : fallback);
const theme = query.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.ptTheme = theme;
document.documentElement.dataset.ptPage = location.pathname.replace(/^\/+|\/+$/g, "") || "gallery";

function useFigures(): { repo: string; figures: Entry[] } | null {
  const [state, setState] = useState<{ repo: string; figures: Entry[] } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/figures").then((r) => r.json()).then((body) => { if (live) setState(body); });
    load();
    import.meta.hot?.on("pt:changed", load);
    return () => { live = false; import.meta.hot?.off("pt:changed", load); };
  }, []);
  return state;
}

/** A figure that failed to load or threw while drawing says so where it would have been. */
class Guard extends Component<{ id: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) { return { error: String((error as Error)?.message ?? error) }; }
  render() {
    if (this.state.error) return <pre className="studio-error" data-pt-error={this.props.id}>{this.props.id}: {this.state.error}</pre>;
    return this.props.children;
  }
}

const loaded = new Map<string, ComponentType<FigureProps>>();
function figureOf(entry: Entry): ComponentType<FigureProps> {
  let found = loaded.get(entry.url);
  if (!found) {
    found = lazy(() => import(/* @vite-ignore */ entry.url));
    loaded.set(entry.url, found);
  }
  return found;
}

function Figure({ entry, ...props }: { entry: Entry } & FigureProps) {
  const Drawn = figureOf(entry);
  return (
    <Guard id={entry.id}>
      <Suspense fallback={<div className="studio-wait">loading {entry.id}</div>}>
        <Drawn theme={theme} {...props} />
      </Suspense>
    </Guard>
  );
}

const link = (page: string, id: string, more = "") => `/${page}?figure=${encodeURIComponent(id)}${more}`;

function Gallery({ repo, figures }: { repo: string; figures: Entry[] }) {
  const groups: [Entry["kind"], string][] = [["figure", "Figures"], ["draft", "Drafts"], ["fixture", "Fixtures"]];
  return (
    <main className="studio-gallery">
      <header>
        <h1>picture-this</h1>
        <p>{repo || "no repo"}</p>
        <nav><a href="/?theme=light">light</a><a href="/?theme=dark">dark</a></nav>
      </header>
      {groups.map(([kind, title]) => {
        const shown = figures.filter((f) => f.kind === kind);
        if (!shown.length) return null;
        return (
          <section key={kind}>
            <h2>{title}</h2>
            {shown.map((entry) => (
              <article key={entry.id}>
                <h3>
                  <span>{entry.id}</span>
                  <a href={link("frame", entry.id, `&theme=${theme}`)}>frame</a>
                  <a href={link("sheet", entry.id, `&theme=${theme}`)}>sheet</a>
                </h3>
                {entry.problem ? <pre className="studio-error">{entry.problem}</pre> : null}
                <div className="studio-figure"><Figure entry={entry} /></div>
              </article>
            ))}
          </section>
        );
      })}
      {figures.length ? null : <p>No figures yet.</p>}
    </main>
  );
}

function Frame({ entry }: { entry: Entry }) {
  const width = Number(query.get("width")) || 880;
  const at = query.has("at") ? Number(query.get("at")) : undefined;
  return (
    <main className="studio-frame" style={{ width }}>
      <Figure
        entry={entry}
        beat={query.get("beat") ?? undefined}
        at={at}
        still={flag("still", false)}
        audience={query.get("audience") === "technical" ? "technical" : "plain"}
        captions={flag("captions", true)}
        controls={flag("controls", true)}
      />
    </main>
  );
}

function Sheet({ entry }: { entry: Entry }) {
  const beats = (entry.model?.beats ?? []).filter((b) => !b.rest);
  const captions = flag("captions", true);
  const width = Number(query.get("width")) || 560;
  const columns = Math.min(beats.length, Number(query.get("columns")) || (beats.length > 4 ? 3 : 2));
  return (
    <main className="studio-sheet" data-pt-sheet={entry.id} style={{ width: columns * (width + 24) + 24 }}>
      <div className="studio-cells" style={{ gridTemplateColumns: `repeat(${columns}, ${width}px)` }}>
        {beats.map((beat, index) => (
          <section key={beat.id} className="studio-cell" data-pt-cell={beat.id}>
            <h2>{String(index + 1).padStart(2, "0")}{captions && beat.title ? ` · ${beat.title}` : ""}</h2>
            <Figure entry={entry} beat={beat.id} at={0.5} still captions={captions} controls={false} audience={query.get("audience") === "technical" ? "technical" : "plain"} />
          </section>
        ))}
      </div>
    </main>
  );
}

function App() {
  const state = useFigures();
  if (!state) return <div className="studio-wait">loading</div>;
  const page = document.documentElement.dataset.ptPage;
  if (page === "gallery") return <Gallery {...state} />;
  const id = query.get("figure") ?? "";
  const entry = state.figures.find((f) => f.id === id);
  if (!entry) return <pre className="studio-error" data-pt-error={id}>no figure '{id}'</pre>;
  return page === "sheet" ? <Sheet entry={entry} /> : <Frame entry={entry} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
