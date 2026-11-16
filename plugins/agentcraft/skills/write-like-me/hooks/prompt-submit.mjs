#!/usr/bin/env node
// UserPromptSubmit: when the prompt carries style feedback about prose, record
// it in the ledger and tell the model to honor it in this reply.
//
// Only for a person who has a writing profile. This area ships in a plugin
// every session loads, and without a profile there is no voice to refine: the
// hook records nothing and says nothing.
//
// Fail open, always exit 0: the person's prompt is never held up.
import fs from "node:fs";
import { detect, excerpt } from "../scripts/wlm/feedback.mjs";
import { append } from "../scripts/wlm/observations.mjs";
import { dataHome, profilePath } from "../scripts/wlm/paths.mjs";
import { readPayload } from "./payload.mjs";

function main() {
  const payload = readPayload();
  const prompt = payload?.prompt;
  if (typeof prompt !== "string" || !prompt) return;
  if (!fs.existsSync(profilePath())) return;

  // Naming the data home brings across what the area kept as a plugin of its
  // own, once (paths.mjs). Done on every prompt of a person with a profile, so
  // the copy is there before the turn this prompt starts reads the changelog
  // or the samples. It makes no folder when there is nothing to copy.
  try { dataHome(); } catch { /* no data home: feedback has nowhere to go, and `append` below says so */ }

  const hit = detect(prompt);
  if (!hit) return;
  const [label, phrase] = hit;

  // Recorded first: feedback the ledger could not take is not promised below.
  append({ session_id: payload.session_id ?? "", label, phrase, prompt_excerpt: excerpt(prompt) });

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `write-like-me: the user just gave style feedback about your prose ("${phrase}"). ` +
        "Honor it in this response, and treat it as a durable preference about their voice, not a one-off. " +
        "It has been recorded and will be folded into their writing profile.",
    },
  }));
}

try { main(); } catch { /* fail open */ }
process.exitCode = 0;
