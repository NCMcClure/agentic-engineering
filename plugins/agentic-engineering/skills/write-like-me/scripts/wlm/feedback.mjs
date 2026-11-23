// Spot style feedback about prose in a prompt.
//
// The patterns are scoped to voice and style corrections, so ordinary code
// review ("this function is too slow") never matches. What the harness injects
// into a prompt (task notifications, system reminders) is stripped before
// matching: trigger words quoted inside a background-task report are not the
// person talking about their voice.

const WORD = "[\\p{L}\\p{N}_]";

/**
 * A pattern written with `\b` and plain letters, compiled so that it means the
 * same in every script: a word boundary counts accented letters and digits of
 * any alphabet as word characters, and an `i` also matches the dotted capital
 * and the dotless small one, which the `i` flag alone leaves out.
 */
function compile(source, flags = "") {
  const unicode = source
    .replace(/^\\b/, `(?<!${WORD})`)
    .replace(/\\b$/, `(?!${WORD})`)
    .replace(/(?<!\\)i/gi, "[i\u0130\u0131]");
  return new RegExp(unicode, `iu${flags}`);
}

// A block the harness wraps in its own tag, whatever it holds.
const HARNESS_BLOCK = compile("<(task-notification|system-reminder)>.*?</\\1>", "gs");
// Any line carrying the harness's marker outside those tags. A line ends at a
// line feed and nowhere else.
const HARNESS_MARKER_LINE = compile("(?:^|(?<=\\n))[^\\n]*\\[SYSTEM NOTIFICATION - NOT USER INPUT\\][^\\n]*(?=\\n|$)", "g");

export const PATTERNS = [
  ["tone", "\\btoo (formal|stiff|corporate|robotic|wordy|flowery|verbose|casual|chirpy|salesy|enthusiastic)\\b"],
  ["tone", "\\bless (formal|corporate|stiff|flowery|wordy|salesy|enthusiastic)\\b"],
  ["tone", "\\bmore (casual|conversational|direct|natural|human|concise|relaxed)\\b"],
  ["ai-sounding", "\\b(sounds?|reads?|feels?) like (an? )?(ai|chatgpt|robot|bot|llm)\\b"],
  ["ai-sounding", "\\bai[- ](generated|written|sounding)\\b"],
  ["ai-sounding", "\\b(humanize|de-?ai)\\b"],
  ["voice", "\\b(not|isn'?t) (my|in my) (voice|style|tone)\\b"],
  ["voice", "\\bdoesn'?t sound like me\\b"],
  ["voice", "\\bi (would ?n[o']?t|never) (say|write|phrase it)\\b"],
  ["voice", "\\b(make|have) it sound (like me|more like me)\\b"],
  ["style-rule", "\\b(stop|quit|avoid|no more|never|don'?t) (using|saying|writing|use|say|write) (the )?(word|phrase|em[- ]?dash(es)?|dashes|bullets?|bullet points|lists?|headers?|headings?|emojis?|exclamation|semicolons?|greetings?|sign[- ]?offs?)\\b"],
  ["style-rule", "\\b(stop|quit|never|don'?t) say(ing)? [\"'\u201c\u2018]"],
  ["style-rule", "\\bstop (using )?(the )?em[- ]?dash(es)?\\b"],
  ["style-rule", "\\bfewer (bullets?|bullet points|lists|headers|headings|emojis)\\b"],
  ["rewrite", "\\bmake (it|this) (warmer|shorter|punchier|friendlier|tighter|plainer|simpler)\\b"],
  ["rewrite", "\\brewrite (it|this|that) (in my voice|to sound|more)\\b"],
];

const COMPILED = PATTERNS.map(([label, source]) => [label, compile(source)]);

/** The prompt with what the harness injected taken out, so only the person's own words remain. */
export function stripHarnessNoise(prompt) {
  return prompt.replace(HARNESS_BLOCK, "").replace(HARNESS_MARKER_LINE, "");
}

/** The first style-feedback match as `[label, matched text]`, or null. Patterns are tried in order. */
export function detect(prompt) {
  const text = stripHarnessNoise(prompt);
  for (const [label, pattern] of COMPILED) {
    const match = pattern.exec(text);
    if (match) return [label, match[0]];
  }
  return null;
}

/** What the ledger keeps of a prompt: the person's words, trimmed, at most 300 characters. */
export function excerpt(prompt) {
  return Array.from(stripHarnessNoise(prompt).trim()).slice(0, 300).join("");
}
