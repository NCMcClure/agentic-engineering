---
name: audit
description: >
  Analyze existing text for AI-writing tells and optionally rewrite it in the
  user's voice. Use when the user runs /write-like-me:audit, asks "does this
  sound AI-written?", wants text checked / audited / scanned for AI tells, or
  asks to "de-AI" or "humanize" an existing draft they provide.
---

# Audit: Find the Tells

Given a text, report what marks it as machine-written — then, if the user
wants, rewrite it in their **voice**.

## Steps

1. **Read the full catalog** at
   [../write-like-me/references/ai-tells.md](../write-like-me/references/ai-tells.md)
   before judging — auditing uses the complete list, not the drafting subset.

2. **Scan for clusters.** Walk the text and collect instances by category
   (lexical, structural/rhetorical, formatting). The audit verdict rests on
   co-occurrence: a lone "crucial" is noise; a tricolon + hedge + trailing
   participle in one paragraph is signal.

3. **Report** with quotes:
   - Verdict up front: reads human / mixed / heavily patterned — with the
     honest caveat that tells are probabilistic (no detector is reliable on a
     single document, and human writers trigger false positives).
   - Each cluster found: the quoted passage, which tells co-occur in it, and
     the one-line fix.
   - The audit is complete when every paragraph has been walked and every
     reported cluster carries a quote — an unquoted finding doesn't count.

4. **Offer the rewrite.** If the user wants it, rewrite the flagged passages
   in their voice — their profile (`~/.claude/rules/write-like-me.md`) governs
   tone and vocabulary; rewrite the sentence rather than swapping the flagged
   word. Show before/after for each changed passage.
