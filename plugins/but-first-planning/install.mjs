#!/usr/bin/env node
// but-first-planning moved into the agentcraft plugin, where its skills are
// routes of the but-first-planning area. A route is a document its area reads,
// not a skill to copy, so there is nothing here to install: this says where to go.
console.log([
  "but-first-planning is now an area of the agentcraft plugin, and this script installs nothing.",
  "",
  "In Claude Code:",
  "  /plugin marketplace add NCMcClure/agentic-engineering",
  "  /plugin install agentcraft@agentic-engineering",
  "",
  "Then type /agentcraft:start-here, or ask for the work in words (\"spec this out\", \"grill me on this idea\").",
].join("\n"));
