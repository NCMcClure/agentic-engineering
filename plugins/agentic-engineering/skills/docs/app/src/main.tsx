// The studio: four pages over the same figures.
//   /        the gallery: every figure, live
//   /frame   one figure and nothing else, for capture
//   /sheet   one figure's beats side by side, as stills
//   /strip   the beats in one row and one frame, for a README
// A figure is imported from where it lives (a repo's figures folder, a draft
// round, a fixture) and given its props from the query string.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./studio.css";
import { Component, StrictMode, Suspense, lazy, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { createRoot } from "react-dom/client";

type Model = { title?: string; claim?: string; beats?: { id: string; title?: string; plain?: string; technical?: string; rest?: boolean }[]; hero?: { beat: string; at?: number } };
type View = { view?: string; base?: string; drawn?: string; moves?: string; means?: string };
type Entry = { id: string; kind: "figure" | "draft" | "fixture"; dir: string; url: string; model: Model | null; problem: string | null; view?: View | null };
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
      {captions && entry.view?.view ? <Stated view={entry.view} /> : null}
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

/**
 * A draft's view in its own words, over its sheet: what is drawn, what moves,
 * what each visual property means. Left off the caption-free sheet, which a
 * cold reader must read without being told.
 */
function Stated({ view }: { view: View }) {
  const said = ([["drawn", view.drawn], ["moves", view.moves], ["means", view.means]] as const).filter(([, text]) => text && text.trim());
  return (
    <header className="studio-view" data-pt-view={view.view}>
      <h1>{view.view}<span>{view.base && view.base !== "blank" ? `from the ${view.base} study` : "drawn on the blank stage"}</span></h1>
      {said.length ? <dl>{said.map(([key, text]) => <div key={key}><dt>{key}</dt><dd>{text}</dd></div>)}</dl> : <p>its view is not stated yet</p>}
    </header>
  );
}

// What a strip's words are sized against: the width a README shows a picture at.
const READ_AT = 880;

/**
 * The told beats in one row, inside one frame drawn in the figure's own
 * colours: each beat held at its middle with its number, title and caption
 * under it, and the claim once beneath them all. The row is far wider than a
 * README will show it, so its words are set larger by as much and read at
 * the size a still's do.
 */
function Strip({ entry }: { entry: Entry }) {
  const beats = (entry.model?.beats ?? []).filter((b) => !b.rest);
  const width = Number(query.get("width")) || 640;
  const technical = query.get("audience") === "technical";
  const type = Math.max(1, (beats.length * width) / READ_AT);
  return (
    <main className="studio-strip">
      <figure className="pt-stage studio-strip-frame" data-pt-strip={entry.id} data-pt-theme={theme} style={{ width: beats.length * (width + 1) + 1, fontSize: 14 * type }}>
        <div className="studio-strip-row" style={{ gridTemplateColumns: `repeat(${beats.length}, ${width}px)` }}>
          {beats.map((beat, index) => (
            <section key={beat.id} className="studio-strip-beat" data-pt-cell={beat.id}>
              <Figure entry={entry} beat={beat.id} at={0.5} still captions={false} controls={false} audience={technical ? "technical" : "plain"} />
              <p className="studio-strip-words">
                <span className="pt-caption-mark">{String(index + 1).padStart(2, "0")}{beat.title ? ` · ${beat.title}` : ""}</span>
                <span className="pt-caption-text">{(technical && beat.technical) || beat.plain}</span>
              </p>
            </section>
          ))}
        </div>
        {entry.model?.claim ? <p className="studio-strip-claim">{entry.model.claim}</p> : null}
      </figure>
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
  if (page === "strip") return <Strip entry={entry} />;
  return page === "sheet" ? <Sheet entry={entry} /> : <Frame entry={entry} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
