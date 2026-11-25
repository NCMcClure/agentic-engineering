// The prompts the trigger check sends, each for the route it should end in,
// and the scenario the skill-compaction check works inside.
//
// A prompt asks the way a person would, so it measures routing: from the
// skill listing, where the plugin shows its entry skill and an area each, to
// the area and on to the route's instructions. It never carries an address or a
// slash command, and it shares no run of four words with any description in
// the tree, which the unit tests hold: a prompt that quotes the listing
// measures string matching. A word a person would really say for the task
// (ship, README, board) is allowed, and `named` records it, so the totals can
// be read apart for the prompts that name their skill and those that do not.
//
// A row is `{ plugin, skill }`: an area, and a route of it. The two keys are
// named for what they held when each area was a plugin of its own and each
// route a skill, and a baseline recorded then carries the same two names, so
// a row reads the same against a baseline from either side of the move
// (reach.mjs). A row whose two names are one is the area itself, reached by
// its own page and no route: the entry skill, and an area whose main job is
// its own.
//
// `person` marks a route only a person starts (its area's door.json says
// `"starts": "person"`). When these were skills the host refused a session's
// call on one, so a session reached it only by reading its file; a route is a
// document an agent may open, and its area tells it to wait for the person.
// The totals are printed apart for those rows, because they moved for a
// reason that is not routing.
//
// The table holds every route the tree refers to five times or more, and one
// more in every area. `fixture` is the repo the prompt runs in
// (fixtures.mjs): "standard" carries every area's marker, "portable" is a
// repo with none where the person answered `on`. The fixtures where nothing is
// answered are left out, because a session there asks that question before
// anything else.

export const MOST_REFERENCED = ["bootstrap", "sync", "tdd", "orchestrate", "init-project", "calibrate", "map-init",
  "init", "review", "map-sync", "browser-setup", "ladder", "spec-init", "ship", "build-tdd", "work-card", "setup",
  "locks"];

const words = (text) => String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Whether a prompt says its skill's name: the name's words in a row, each allowed an ending ("hub" names hubs, "shipped" names ship). */
export function names(prompt, skill) {
  const stems = words(skill).map((w) => w.replace(/s$/, ""));
  const said = words(prompt);
  return said.some((_, i) => stems.every((stem, j) => said[i + j]?.startsWith(stem)));
}

/** How a row is printed and recorded: the area and its route, or the one name of an area reached by its own page. Never an address. */
export const labelOf = ({ plugin, skill }) => (plugin === skill ? skill : `${plugin} ${skill}`);

const row = (plugin, skill, prompt, { fixture = "standard", person = false } = {}) => ({ plugin, skill, fixture, person, prompt, named: names(prompt, skill) });
// In the baseline (2026-11-15) no person row was reached, 0 of 54. Where a session
// picked the right skill the host refused the call, and it went no further.
const PERSON = { fixture: "portable", person: true };

export const TRIGGERS = [
  // The skill a person types, in no baseline before the one it was added with. It is no area's route, so it carries its one name twice.
  row("start-here", "start-here", "These plugins got installed for me and I have no idea what any of them are for. Show me around."),
  row("delivery", "bootstrap", "I am about to start coding in this folder and it has none of our team scaffolding yet. Get it set up the way our repos are, before I write anything.", PERSON),
  row("delivery", "init-project", "Scaffold a brand new team repo here from the node-service template and call it billing-sync.", PERSON),
  // A known miss, 0 of 6 in the baseline: every session read the marker and the source and set about answering it itself.
  row("delivery", "tdd", "Tests that need a real database have nowhere to run in this repo. Give it an integration lane for them and tell me what stays mocked."),
  row("delivery", "ship", "This change is finished and tested. Ship it."),
  row("delivery", "land", "Pull request 12 has its approval. See it through to merged once CI passes."),
  // A known miss, 0 of 6 in the baseline: every session read the repo and started on the three changes itself.
  row("agents", "orchestrate", "Three changes for this repo: add a --version flag, start a CHANGELOG.md, and write a usage section in the README. Work on all three at once, one session each, and merge each only after you have looked it over."),
  row("agents", "work-card", "You were opened to build card 0007 off the kanban board, and nothing else. Start on it."),
  row("harness", "setup", "Get this repository ready for agents: the .agents folder, the hubs, the launcher, whatever your tooling needs to be in place.", PERSON),
  row("agents", "locks", "I need the dev server up on port 3000 to check something, but another agent session on this laptop might already be holding that port. Go ahead and start it safely."),
  row("agents", "board", "The changelog is stale, but fixing it is not part of what we are doing right now. Put it on the board so it is not forgotten."),
  row("planning", "spec-init", "I want to plan the next big feature for this repo properly, starting from a written spec. Nothing for that exists here yet: get the planning workspace in place.", PERSON),
  // A known miss, 0 of 6 in the baseline: the fixture plan holds no issues, and every session looked for issue 3 and stopped there.
  row("planning", "build-tdd", "Issue 3 of our plan is next. Implement it, with what it says counts as done driving the tests."),
  row("planning", "grill", "I want some kind of caching in this app, and I have not thought it through. Help me work out what I actually want before we plan anything."),
  // A known miss, 0 of 6 in the baseline: every session went straight to writing the function. It asks for the
  // function in the reply because a session has no tool to write a file with, and one that kept trying ran out of turns.
  row("code", "ladder", "I need a function that turns a title into a URL slug. No frameworks, nothing clever: the plainest thing that does the job. Paste it in your reply and I'll place it myself."),
  // A known miss, 0 of 6 in the baseline: every session searched the repo for a date parser itself.
  row("code", "reuse", "I am about to write a date-parsing helper for this app. Find out first whether we already have one somewhere."),
  row("code", "restructure", "This repo has grown for years without a cleanup: thousand-line files and a directory tree nobody can navigate. Take it apart and put it back in order, in safe steps."),
  // A known miss, 0 of 6 in the baseline: every session read src/app.py and the guide and set about the edit itself.
  row("docs", "sync", "I changed what the app does in src/app.py, and the guide still describes the old behavior. Fix that before I commit."),
  row("docs", "init", "This repo has a guide for users and nothing that keeps it honest. Wire up whatever makes it get checked against the code as I work and in CI.", PERSON),
  row("docs", "readme", "Our README has grown into a wall of internal notes. Cut it down to something a newcomer can read in two minutes and act on."),
  row("design", "design", "The rendered candidate comes out darker than the reference picture. Fix how it looks."),
  // A known miss, 0 of 6 in the baseline: every session read the app and its docs and described the flow itself.
  row("docs", "figure", "Make me a small moving diagram that shows how a request travels through this app, something I could put at the top of the README."),
  // The lens left plugin-workbench for an area of its own, context-doctor, and plugin-workbench got a row for what it kept;
  // both are harness now. Neither is in a baseline recorded before that move: it holds the lens as a skill of plugin-workbench.
  // The complaint goes to diagnose, the area's default since it had one; the lens keeps the plain ask to be shown everything.
  row("harness", "diagnose", "In my last session here the agent dropped our commit rules partway through, right after the conversation got compacted. Work out what broke and what I should change."),
  row("harness", "lens", "I want to look over everything that went into the agent's window during my last session here, hook by hook, with how big each request was."),
  row("harness", "plugin-create", "I keep pasting the same three helper scripts into every session. Package them up as something my teammates could install."),
  row("docs", "map-init", "I would like an architecture diagram for this repo that is built from the code itself and kept on Miro. There is nothing like that here yet, so set it up from scratch.", PERSON),
  // A known miss, 0 of 6 in the baseline: the fixture carries no .agents/system-map.json, and every session searched for a diagram and found none.
  row("docs", "map-sync", "I just added a module under src/ that calls into app.py. The architecture diagram no longer matches the code: bring it up to date."),
  row("docs", "browser-setup", "The live check against Miro cannot find a browser to drive on this machine. Get that sorted.", PERSON),
  row("docs", "miro", "Our team Miro board needs a frame showing how this repo's modules fit together. Draw it."),
  // A known miss, 0 of 6 in the baseline: every session called the host's own bundled workflow-authoring skill.
  row("harness", "workflow", "Write me a workflow script for Claude Code that reviews a diff in three parallel passes and then merges what they found."),
  row("writing", "calibrate", "Set up my writing voice from scratch: look at how I write and build the profile you will use from now on.", PERSON),
  row("writing", "review", "Show me what the style learning has altered in my profile lately, and take back the most recent alteration.", PERSON),
  // A known miss, 0 of 6 in the baseline: nearly every session answered from the quoted line with no tool call.
  row("writing", "audit", "Here is a line from my draft announcement: \"We are thrilled to unveil a game-changing platform that seamlessly empowers teams.\" Does that read like a machine wrote it?"),
];

// The skill-compaction check is not about routing, so its first prompt names
// the route and the area's skill outright: the session has to be inside it
// when the compaction comes.
export const COMPACTION = {
  plugin: "delivery",
  skill: "tdd",
  fixture: "standard",
  before: "Work with the tdd route of the agentic-engineering:delivery skill on this: I am about to add a function to src/. Tell me in two lines the first step the route has me take. Change no file.",
  after: "Carry on with the route you were following: what is the step after that one? Two lines. Change no file.",
};
