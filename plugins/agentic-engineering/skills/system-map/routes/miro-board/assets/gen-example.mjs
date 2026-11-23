// A generator: build.mjs calls it with the drawing kit and the view's args, and it
// returns a scene. This one is a three-stage pipeline with a store underneath, laid out
// to the rules the lint enforces (see the miro-board skill's how-miro-draws reference).
export default function generate({ createScene, MUTED }) {
  const s = createScene();
  const W = 300, H = 120, GAP = 160, Y = 120;
  s.text("title", 60, 40, "Example pipeline", { size: 40 });
  // One row, centers aligned: each connector is straight and has room for its caption.
  const stages = [
    ["ask", "Request", ["What someone asks for"]],
    ["check", "Value check", ["Is it worth building?"]],
    ["build", "Build", ["The work itself"]],
  ];
  stages.forEach(([id, title, body], i) => s.card(id, 60 + i * (W + GAP), Y, W, H, { color: i === 1 ? "yellow" : "blue", title, body }));
  s.arrow("a1", "ask", "check", [s.R(s.nodes.ask), s.L(s.nodes.check)], { label: "submits" });
  s.arrow("a2", "check", "build", [s.R(s.nodes.check), s.L(s.nodes.build)], { label: "approves" });
  // A store under the middle stage: centered under it, so its connector is straight too.
  s.card("store", 60 + W + GAP, Y + H + 140, W, 90, { color: "gray", title: "Decisions", body: ["Every verdict, kept"] });
  s.arrow("a3", "check", "store", [s.B(s.nodes.check), s.T(s.nodes.store)], { label: "records", color: MUTED });
  return s;
}
