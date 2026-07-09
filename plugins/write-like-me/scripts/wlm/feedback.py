"""Detect style feedback about prose in a user prompt.

Patterns are deliberately scoped to voice/style corrections so ordinary
code-review feedback ("this function is too slow") never matches. Harness
injections (task notifications, system reminders) are stripped before
matching — trigger words quoted inside a background-task report are not
the user talking about voice.
"""

import re

# Harness-injected content that rides along in the "prompt" but is not user
# input: <task-notification>/<system-reminder> blocks, plus any stray
# "[SYSTEM NOTIFICATION - NOT USER INPUT]" line outside those tags.
_HARNESS_BLOCK = re.compile(
    r"<(task-notification|system-reminder)>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_HARNESS_MARKER_LINE = re.compile(
    r"^.*\[SYSTEM NOTIFICATION - NOT USER INPUT\].*$",
    re.IGNORECASE | re.MULTILINE,
)

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


def strip_harness_noise(prompt: str) -> str:
    """Drop harness-injected blocks so only the user's own words remain."""
    prompt = _HARNESS_BLOCK.sub("", prompt)
    return _HARNESS_MARKER_LINE.sub("", prompt)


def detect(prompt: str):
    """Return (label, matched_text) for the first style-feedback match, else None."""
    prompt = strip_harness_noise(prompt)
    for label, rx in _COMPILED:
        m = rx.search(prompt)
        if m:
            return label, m.group(0)
    return None
