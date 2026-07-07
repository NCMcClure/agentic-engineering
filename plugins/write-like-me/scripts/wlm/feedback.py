"""Detect style feedback about prose in a user prompt.

Patterns are deliberately scoped to voice/style corrections so ordinary
code-review feedback ("this function is too slow") never matches.
"""

import re

_PATTERNS = [
    ("tone", r"\btoo (formal|stiff|corporate|robotic|wordy|flowery|verbose|casual|chirpy|salesy|enthusiastic)\b"),
    ("tone", r"\bless (formal|corporate|stiff|flowery|wordy|salesy|enthusiastic)\b"),
    ("tone", r"\bmore (casual|conversational|direct|natural|human|concise|relaxed)\b"),
    ("ai-sounding", r"\b(sounds?|reads?|feels?) like (an? )?(ai|chatgpt|robot|bot|llm)\b"),
    ("ai-sounding", r"\bai[- ](generated|written|sounding)\b"),
    ("ai-sounding", r"\b(humanize|de-?ai)\b"),
    ("voice", r"\b(not|isn'?t) (my|in my) (voice|style|tone)\b"),
    ("voice", r"\bdoesn'?t sound like me\b"),
    ("voice", r"\bi (would ?n[o']?t|never) (say|write|phrase it)\b"),
    ("voice", r"\b(make|have) it sound (like me|more like me)\b"),
    ("style-rule", r"\b(stop|quit|avoid|no more|never|don'?t) (using|saying|writing|use|say|write) (the )?(word|phrase|em[- ]?dash(es)?|dashes|bullets?|bullet points|lists?|headers?|headings?|emojis?|exclamation|semicolons?|greetings?|sign[- ]?offs?)\b"),
    ("style-rule", r"\b(stop|quit|never|don'?t) say(ing)? [\"'“‘]"),
    ("style-rule", r"\bstop (using )?(the )?em[- ]?dash(es)?\b"),
    ("style-rule", r"\bfewer (bullets?|bullet points|lists|headers|headings|emojis)\b"),
    ("rewrite", r"\bmake (it|this) (warmer|shorter|punchier|friendlier|tighter|plainer|simpler)\b"),
    ("rewrite", r"\brewrite (it|this|that) (in my voice|to sound|more)\b"),
]

_COMPILED = [(label, re.compile(rx, re.IGNORECASE)) for label, rx in _PATTERNS]


def detect(prompt: str):
    """Return (label, matched_text) for the first style-feedback match, else None."""
    for label, rx in _COMPILED:
        m = rx.search(prompt)
        if m:
            return label, m.group(0)
    return None
