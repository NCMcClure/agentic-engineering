#!/usr/bin/env node
// UserPromptSubmit: when the prompt carries style feedback about prose, record
// it in the ledger and tell the model to honor it in this reply.
//
// Fail open, always exit 0: the person's prompt is never held up.
import { detect, excerpt } from "../scripts/wlm/feedback.mjs";
import { append } from "../scripts/wlm/observations.mjs";
import { readPayload } from "./payload.mjs";

function main() {
  const payload = readPayload();
  const prompt = payload?.prompt;
  if (typeof prompt !== "string" || !prompt) return;

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
