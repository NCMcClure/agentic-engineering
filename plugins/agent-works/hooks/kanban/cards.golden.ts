// Generated from tests/fixtures/cards by `python -B tests/test_kanban.py --write-golden`. Do not edit.
// A mod's tests read no files, so the golden cards the Python twin reads from disk are laid out here.
import type { Card } from '../../types'

/** One fixture card: its file, its text, the file a write turns it into, and the card both parsers must give. */
export type Golden = { file: string; text: string; canon: string | null; card: Card | null }

export const GOLDEN: readonly Golden[] = [
  {
    "file": "0001-write-the-readme.md",
    "text": "---\nid: \"0001\"\ntitle: \"Write the README\"\nstatus: backlog\norder: 0\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\n---\n",
    "canon": "---\nid: \"0001\"\ntitle: \"Write the README\"\nstatus: backlog\norder: 0\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\n---\n",
    "card": {
      "id": "0001",
      "file": "0001-write-the-readme.md",
      "title": "Write the README",
      "status": "backlog",
      "order": 0,
      "priority": "normal",
      "labels": [],
      "skills": [],
      "source": "user",
      "created": "2026-01-05T10:00:00.000Z",
      "updated": "2026-01-05T10:00:00.000Z",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0002-fix-race-in-session-cache.md",
    "text": "---\nid: \"0002\"\ntitle: \"Fix race in session cache\"\nstatus: in-progress\norder: 1\npriority: high\nlabels: [\"bug\",\"needs triage\"]\nskills: [\"code-review\",\"agent-works:kanban-cards\"]\nsource: claude\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-06T08:30:15.250Z\nowner: \"worker-2\"\nneeds: \"a quiet machine\"\nref: \"#41\"\n---\n\nTwo writers, no lock.\n\nFiles:\n- src/cache.ts\n- src/session/store.ts\n",
    "canon": "---\nid: \"0002\"\ntitle: \"Fix race in session cache\"\nstatus: in-progress\norder: 1\npriority: high\nlabels: [\"bug\",\"needs triage\"]\nskills: [\"code-review\",\"agent-works:kanban-cards\"]\nsource: claude\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-06T08:30:15.250Z\nowner: \"worker-2\"\nneeds: \"a quiet machine\"\nref: \"#41\"\n---\n\nTwo writers, no lock.\n\nFiles:\n- src/cache.ts\n- src/session/store.ts\n",
    "card": {
      "id": "0002",
      "file": "0002-fix-race-in-session-cache.md",
      "title": "Fix race in session cache",
      "status": "in-progress",
      "order": 1,
      "priority": "high",
      "labels": [
        "bug",
        "needs triage"
      ],
      "skills": [
        "code-review",
        "agent-works:kanban-cards"
      ],
      "source": "claude",
      "created": "2026-01-05T10:00:00.000Z",
      "updated": "2026-01-06T08:30:15.250Z",
      "kind": "task",
      "owner": "worker-2",
      "needs": "a quiet machine",
      "ref": "#41",
      "epic": "",
      "sprint": "",
      "body": "Two writers, no lock.\n\nFiles:\n- src/cache.ts\n- src/session/store.ts",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0003-linked-to-a-github-issue.md",
    "text": "---\nid: \"0003\"\ntitle: \"Linked to a GitHub issue\"\nstatus: review\norder: 0\npriority: normal\nlabels: [\"docs\"]\nskills: []\nsource: user\ncreated: 2026-01-02T03:04:05Z\nupdated: 2026-01-02T03:04:05Z\nremote:\n  provider: github\n  number: 12\n  url: https://github.com/example/repo/issues/12\n  updatedAt: 2026-01-02T03:04:05Z\n  syncedHash: 9f3a1c2b\n---\n\nThe issue's body, as the last sync left it.\n",
    "canon": "---\nid: \"0003\"\ntitle: \"Linked to a GitHub issue\"\nstatus: review\norder: 0\npriority: normal\nlabels: [\"docs\"]\nskills: []\nsource: user\ncreated: 2026-01-02T03:04:05Z\nupdated: 2026-01-02T03:04:05Z\nremote:\n  provider: github\n  number: 12\n  url: https://github.com/example/repo/issues/12\n  updatedAt: 2026-01-02T03:04:05Z\n  syncedHash: 9f3a1c2b\n---\n\nThe issue's body, as the last sync left it.\n",
    "card": {
      "id": "0003",
      "file": "0003-linked-to-a-github-issue.md",
      "title": "Linked to a GitHub issue",
      "status": "review",
      "order": 0,
      "priority": "normal",
      "labels": [
        "docs"
      ],
      "skills": [],
      "source": "user",
      "created": "2026-01-02T03:04:05Z",
      "updated": "2026-01-02T03:04:05Z",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "The issue's body, as the last sync left it.",
      "remote": {
        "provider": "github",
        "number": 12,
        "url": "https://github.com/example/repo/issues/12",
        "updatedAt": "2026-01-02T03:04:05Z",
        "syncedHash": "9f3a1c2b"
      },
      "extra": []
    }
  },
  {
    "file": "0004-linked-to-a-gitlab-issue.md",
    "text": "---\nid: \"0004\"\ntitle: \"Linked to a GitLab issue\"\nstatus: done\norder: 3\npriority: low\nlabels: [\"team: platform\",\"p2\"]\nskills: []\nsource: user\ncreated: 2026-02-01T00:00:00.000Z\nupdated: 2026-02-03T12:00:00.000Z\nowner: \"sam\"\nremote:\n  provider: gitlab\n  number: 7\n  url: https://gitlab.com/example/repo/-/issues/7\n  updatedAt: 2026-02-03T11:59:58.000Z\n  syncedHash: 1b2c3d\n---\n\nClosed upstream.\n",
    "canon": "---\nid: \"0004\"\ntitle: \"Linked to a GitLab issue\"\nstatus: done\norder: 3\npriority: low\nlabels: [\"team: platform\",\"p2\"]\nskills: []\nsource: user\ncreated: 2026-02-01T00:00:00.000Z\nupdated: 2026-02-03T12:00:00.000Z\nowner: \"sam\"\nremote:\n  provider: gitlab\n  number: 7\n  url: https://gitlab.com/example/repo/-/issues/7\n  updatedAt: 2026-02-03T11:59:58.000Z\n  syncedHash: 1b2c3d\n---\n\nClosed upstream.\n",
    "card": {
      "id": "0004",
      "file": "0004-linked-to-a-gitlab-issue.md",
      "title": "Linked to a GitLab issue",
      "status": "done",
      "order": 3,
      "priority": "low",
      "labels": [
        "team: platform",
        "p2"
      ],
      "skills": [],
      "source": "user",
      "created": "2026-02-01T00:00:00.000Z",
      "updated": "2026-02-03T12:00:00.000Z",
      "kind": "task",
      "owner": "sam",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "Closed upstream.",
      "remote": {
        "provider": "gitlab",
        "number": 7,
        "url": "https://gitlab.com/example/repo/-/issues/7",
        "updatedAt": "2026-02-03T11:59:58.000Z",
        "syncedHash": "1b2c3d"
      },
      "extra": []
    }
  },
  {
    "file": "0005-keys-the-board-does-not-know.md",
    "text": "---\nid: \"0005\"\ntitle: \"Keys the board does not know\"\nstatus: backlog\norder: 2\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\nestimate: 3\nreviewer: \"sam\"\nblocked-by: [0002, 0003]\ndue: 2026-03-01\n---\n\nWritten by a script that keeps its own keys beside the board's.\n",
    "canon": "---\nid: \"0005\"\ntitle: \"Keys the board does not know\"\nstatus: backlog\norder: 2\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\nestimate: 3\nreviewer: \"sam\"\nblocked-by: [0002, 0003]\ndue: 2026-03-01\n---\n\nWritten by a script that keeps its own keys beside the board's.\n",
    "card": {
      "id": "0005",
      "file": "0005-keys-the-board-does-not-know.md",
      "title": "Keys the board does not know",
      "status": "backlog",
      "order": 2,
      "priority": "normal",
      "labels": [],
      "skills": [],
      "source": "user",
      "created": "2026-01-05T10:00:00.000Z",
      "updated": "2026-01-05T10:00:00.000Z",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "Written by a script that keeps its own keys beside the board's.",
      "remote": null,
      "extra": [
        "estimate: 3",
        "reviewer: \"sam\"",
        "blocked-by: [0002, 0003]",
        "due: 2026-03-01"
      ]
    }
  },
  {
    "file": "0006-a-nested-block-the-board-does-not-know.md",
    "text": "---\nid: \"0006\"\ntitle: \"A nested block the board does not know\"\nstatus: backlog\norder: 3\npriority: normal\nlabels: [\"tooling\"]\nskills: []\nsource: claude\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\nref: \"0005\"\nremote:\n  provider: github\n  number: 31\n  url: https://github.com/example/repo/issues/31\n  updatedAt: 2026-01-05T10:00:00Z\n  syncedHash: abc123\nlinks:\n  - https://example.com/a\n  - https://example.com/b\nreview:\n  by: sam\n  state: \"changes requested\"\n\n# a comment a person left\n---\n\nIts lines come back as they were, after the board's own keys.\n",
    "canon": "---\nid: \"0006\"\ntitle: \"A nested block the board does not know\"\nstatus: backlog\norder: 3\npriority: normal\nlabels: [\"tooling\"]\nskills: []\nsource: claude\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\nref: \"0005\"\nremote:\n  provider: github\n  number: 31\n  url: https://github.com/example/repo/issues/31\n  updatedAt: 2026-01-05T10:00:00Z\n  syncedHash: abc123\nlinks:\n  - https://example.com/a\n  - https://example.com/b\nreview:\n  by: sam\n  state: \"changes requested\"\n\n# a comment a person left\n---\n\nIts lines come back as they were, after the board's own keys.\n",
    "card": {
      "id": "0006",
      "file": "0006-a-nested-block-the-board-does-not-know.md",
      "title": "A nested block the board does not know",
      "status": "backlog",
      "order": 3,
      "priority": "normal",
      "labels": [
        "tooling"
      ],
      "skills": [],
      "source": "claude",
      "created": "2026-01-05T10:00:00.000Z",
      "updated": "2026-01-05T10:00:00.000Z",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "0005",
      "epic": "",
      "sprint": "",
      "body": "Its lines come back as they were, after the board's own keys.",
      "remote": {
        "provider": "github",
        "number": 31,
        "url": "https://github.com/example/repo/issues/31",
        "updatedAt": "2026-01-05T10:00:00Z",
        "syncedHash": "abc123"
      },
      "extra": [
        "links:",
        "  - https://example.com/a",
        "  - https://example.com/b",
        "review:",
        "  by: sam",
        "  state: \"changes requested\"",
        "",
        "# a comment a person left"
      ]
    }
  },
  {
    "file": "0007-fix-the-sync-race-na-ve-caf.md",
    "text": "---\nid: \"0007\"\ntitle: \"Fix: the \\\"sync\\\" race — naïve café ✓ \\\\ 日本語 🚦\"\nstatus: review\norder: 1\npriority: high\nlabels: [\"bug\",\"quote \\\" inside\",\"comma, inside\"]\nskills: [\"perceptual-loop:perceptual-loop\"]\nsource: claude\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-07T09:00:00.000Z\n---\n\nLine one.\n\n- a\n- b\n",
    "canon": "---\nid: \"0007\"\ntitle: \"Fix: the \\\"sync\\\" race — naïve café ✓ \\\\ 日本語 🚦\"\nstatus: review\norder: 1\npriority: high\nlabels: [\"bug\",\"quote \\\" inside\",\"comma, inside\"]\nskills: [\"perceptual-loop:perceptual-loop\"]\nsource: claude\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-07T09:00:00.000Z\n---\n\nLine one.\n\n- a\n- b\n",
    "card": {
      "id": "0007",
      "file": "0007-fix-the-sync-race-na-ve-caf.md",
      "title": "Fix: the \"sync\" race — naïve café ✓ \\ 日本語 🚦",
      "status": "review",
      "order": 1,
      "priority": "high",
      "labels": [
        "bug",
        "quote \" inside",
        "comma, inside"
      ],
      "skills": [
        "perceptual-loop:perceptual-loop"
      ],
      "source": "claude",
      "created": "2026-01-05T10:00:00.000Z",
      "updated": "2026-01-07T09:00:00.000Z",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "Line one.\n\n- a\n- b",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0008-draft-not-a-comment-100-yes-single-tag.md",
    "text": "---\nid: \"0008\"\ntitle: \"--- [draft] # not a comment: 100% {yes} 'single' & <tag>\"\nstatus: backlog\norder: 4\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\n---\n\nA body with a rule in it:\n\n---\n\nand a fence:\n\n```yaml\n---\nstatus: not-frontmatter\n---\n```\n",
    "canon": "---\nid: \"0008\"\ntitle: \"--- [draft] # not a comment: 100% {yes} 'single' & <tag>\"\nstatus: backlog\norder: 4\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\n---\n\nA body with a rule in it:\n\n---\n\nand a fence:\n\n```yaml\n---\nstatus: not-frontmatter\n---\n```\n",
    "card": {
      "id": "0008",
      "file": "0008-draft-not-a-comment-100-yes-single-tag.md",
      "title": "--- [draft] # not a comment: 100% {yes} 'single' & <tag>",
      "status": "backlog",
      "order": 4,
      "priority": "normal",
      "labels": [],
      "skills": [],
      "source": "user",
      "created": "2026-01-05T10:00:00.000Z",
      "updated": "2026-01-05T10:00:00.000Z",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "A body with a rule in it:\n\n---\n\nand a fence:\n\n```yaml\n---\nstatus: not-frontmatter\n---\n```",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0009-run-the-smoke-gate-on-main.md",
    "text": "---\nid: \"0009\"\ntitle: \"Run the smoke gate on main\"\nstatus: backlog\norder: 5\npriority: normal\nlabels: []\nskills: []\nsource: claude\ncreated: 2026-01-08T14:00:00.000Z\nupdated: 2026-01-08T14:00:00.000Z\nkind: gate\nowner: \"the integrator\"\nneeds: \"the main checkout\"\nref: \"#213\"\n---\n\n`npm run smoke` on main after the merge; passing is 27 of 27. Could not be run from a worktree.\n",
    "canon": "---\nid: \"0009\"\ntitle: \"Run the smoke gate on main\"\nstatus: backlog\norder: 5\npriority: normal\nlabels: []\nskills: []\nsource: claude\ncreated: 2026-01-08T14:00:00.000Z\nupdated: 2026-01-08T14:00:00.000Z\nkind: gate\nowner: \"the integrator\"\nneeds: \"the main checkout\"\nref: \"#213\"\n---\n\n`npm run smoke` on main after the merge; passing is 27 of 27. Could not be run from a worktree.\n",
    "card": {
      "id": "0009",
      "file": "0009-run-the-smoke-gate-on-main.md",
      "title": "Run the smoke gate on main",
      "status": "backlog",
      "order": 5,
      "priority": "normal",
      "labels": [],
      "skills": [],
      "source": "claude",
      "created": "2026-01-08T14:00:00.000Z",
      "updated": "2026-01-08T14:00:00.000Z",
      "kind": "gate",
      "owner": "the integrator",
      "needs": "the main checkout",
      "ref": "#213",
      "epic": "",
      "sprint": "",
      "body": "`npm run smoke` on main after the merge; passing is 27 of 27. Could not be run from a worktree.",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0010-full-test-pass-before-release.md",
    "text": "---\nid: \"0010\"\ntitle: \"Full test pass before release\"\nstatus: done\norder: 0\npriority: high\nlabels: []\nskills: []\nsource: claude\ncreated: 2026-01-08T14:00:00.000Z\nupdated: 2026-01-09T16:45:10.000Z\nkind: gate\nneeds: \"a free GPU\"\nref: \"PR 214\"\n---\n\nThe whole suite, once, when the work is finished.\n\nSettled 2026-01-09T16:45:10.000Z by worker-1: `npm test` 412 passed, 0 failed\n",
    "canon": "---\nid: \"0010\"\ntitle: \"Full test pass before release\"\nstatus: done\norder: 0\npriority: high\nlabels: []\nskills: []\nsource: claude\ncreated: 2026-01-08T14:00:00.000Z\nupdated: 2026-01-09T16:45:10.000Z\nkind: gate\nneeds: \"a free GPU\"\nref: \"PR 214\"\n---\n\nThe whole suite, once, when the work is finished.\n\nSettled 2026-01-09T16:45:10.000Z by worker-1: `npm test` 412 passed, 0 failed\n",
    "card": {
      "id": "0010",
      "file": "0010-full-test-pass-before-release.md",
      "title": "Full test pass before release",
      "status": "done",
      "order": 0,
      "priority": "high",
      "labels": [],
      "skills": [],
      "source": "claude",
      "created": "2026-01-08T14:00:00.000Z",
      "updated": "2026-01-09T16:45:10.000Z",
      "kind": "gate",
      "owner": "",
      "needs": "a free GPU",
      "ref": "PR 214",
      "epic": "",
      "sprint": "",
      "body": "The whole suite, once, when the work is finished.\n\nSettled 2026-01-09T16:45:10.000Z by worker-1: `npm test` 412 passed, 0 failed",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0011-stale-docs-for-the-export-command.md",
    "text": "---\nid: \"0011\"\ntitle: \"Stale docs for the export command\"\nstatus: suggested\norder: 0\npriority: low\nlabels: [\"docs\"]\nskills: []\nsource: claude\ncreated: 2026-01-10T09:00:00.000Z\nupdated: 2026-01-10T09:00:00.000Z\n---\n\nThe README names a flag that was removed.\n\nFiles:\n- README.md\n",
    "canon": "---\nid: \"0011\"\ntitle: \"Stale docs for the export command\"\nstatus: suggested\norder: 0\npriority: low\nlabels: [\"docs\"]\nskills: []\nsource: claude\ncreated: 2026-01-10T09:00:00.000Z\nupdated: 2026-01-10T09:00:00.000Z\n---\n\nThe README names a flag that was removed.\n\nFiles:\n- README.md\n",
    "card": {
      "id": "0011",
      "file": "0011-stale-docs-for-the-export-command.md",
      "title": "Stale docs for the export command",
      "status": "suggested",
      "order": 0,
      "priority": "low",
      "labels": [
        "docs"
      ],
      "skills": [],
      "source": "claude",
      "created": "2026-01-10T09:00:00.000Z",
      "updated": "2026-01-10T09:00:00.000Z",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "The README names a flag that was removed.\n\nFiles:\n- README.md",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0012-a-title-long-enough-that-its-slug-is-cut-at-fort.md",
    "text": "---\nid: \"0012\"\ntitle: \"A title long enough that its slug is cut at forty-eight characters, and then some more\"\nstatus: archived\norder: 7\npriority: low\nlabels: []\nskills: []\nsource: user\ncreated: 2025-12-01T00:00:00.000Z\nupdated: 2025-12-24T00:00:00.000Z\n---\n",
    "canon": "---\nid: \"0012\"\ntitle: \"A title long enough that its slug is cut at forty-eight characters, and then some more\"\nstatus: archived\norder: 7\npriority: low\nlabels: []\nskills: []\nsource: user\ncreated: 2025-12-01T00:00:00.000Z\nupdated: 2025-12-24T00:00:00.000Z\n---\n",
    "card": {
      "id": "0012",
      "file": "0012-a-title-long-enough-that-its-slug-is-cut-at-fort.md",
      "title": "A title long enough that its slug is cut at forty-eight characters, and then some more",
      "status": "archived",
      "order": 7,
      "priority": "low",
      "labels": [],
      "skills": [],
      "source": "user",
      "created": "2025-12-01T00:00:00.000Z",
      "updated": "2025-12-24T00:00:00.000Z",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0013-a-status-and-a-kind-of-its-own.md",
    "text": "---\nid: \"0013\"\ntitle: \"A status and a kind of its own\"\nstatus: blocked\norder: 1.5\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: 2026-01-11T00:00:00.000Z\nupdated: 2026-01-11T00:00:00.000Z\nkind: spike\n---\n\nShown in the first column; lint names both.\n",
    "canon": "---\nid: \"0013\"\ntitle: \"A status and a kind of its own\"\nstatus: blocked\norder: 1.5\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: 2026-01-11T00:00:00.000Z\nupdated: 2026-01-11T00:00:00.000Z\nkind: spike\n---\n\nShown in the first column; lint names both.\n",
    "card": {
      "id": "0013",
      "file": "0013-a-status-and-a-kind-of-its-own.md",
      "title": "A status and a kind of its own",
      "status": "blocked",
      "order": 1.5,
      "priority": "normal",
      "labels": [],
      "skills": [],
      "source": "user",
      "created": "2026-01-11T00:00:00.000Z",
      "updated": "2026-01-11T00:00:00.000Z",
      "kind": "spike",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "Shown in the first column; lint names both.",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0014-move-the-sync-to-graphql.md",
    "text": "---\nid: \"0014\"\ntitle: \"Move the sync to GraphQL\"\nstatus: in-progress\norder: 0\npriority: normal\nlabels: [\"sync\"]\nskills: []\nsource: user\ncreated: 2026-02-02T09:00:00.000Z\nupdated: 2026-02-03T10:30:00.000Z\nepic: \"0015\"\nsprint: \"s2\"\n---\n\nOne query for the issues and their project columns instead of one call per issue.\n",
    "canon": "---\nid: \"0014\"\ntitle: \"Move the sync to GraphQL\"\nstatus: in-progress\norder: 0\npriority: normal\nlabels: [\"sync\"]\nskills: []\nsource: user\ncreated: 2026-02-02T09:00:00.000Z\nupdated: 2026-02-03T10:30:00.000Z\nepic: \"0015\"\nsprint: \"s2\"\n---\n\nOne query for the issues and their project columns instead of one call per issue.\n",
    "card": {
      "id": "0014",
      "file": "0014-move-the-sync-to-graphql.md",
      "title": "Move the sync to GraphQL",
      "status": "in-progress",
      "order": 0,
      "priority": "normal",
      "labels": [
        "sync"
      ],
      "skills": [],
      "source": "user",
      "created": "2026-02-02T09:00:00.000Z",
      "updated": "2026-02-03T10:30:00.000Z",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "0015",
      "sprint": "s2",
      "body": "One query for the issues and their project columns instead of one call per issue.",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0015-sync-that-scales-to-a-thousand-issues.md",
    "text": "---\nid: \"0015\"\ntitle: \"Sync that scales to a thousand issues\"\nstatus: backlog\norder: 1\npriority: high\nlabels: []\nskills: []\nsource: user\ncreated: 2026-02-01T09:00:00.000Z\nupdated: 2026-02-01T09:00:00.000Z\nkind: epic\n---\n\n## Goal\n\nA board linked to a repository with a thousand open issues syncs in under ten seconds.\n\n## Done looks like\n\n- One GraphQL round trip per page of issues.\n- No pull rewrites a card that did not change.\n",
    "canon": "---\nid: \"0015\"\ntitle: \"Sync that scales to a thousand issues\"\nstatus: backlog\norder: 1\npriority: high\nlabels: []\nskills: []\nsource: user\ncreated: 2026-02-01T09:00:00.000Z\nupdated: 2026-02-01T09:00:00.000Z\nkind: epic\n---\n\n## Goal\n\nA board linked to a repository with a thousand open issues syncs in under ten seconds.\n\n## Done looks like\n\n- One GraphQL round trip per page of issues.\n- No pull rewrites a card that did not change.\n",
    "card": {
      "id": "0015",
      "file": "0015-sync-that-scales-to-a-thousand-issues.md",
      "title": "Sync that scales to a thousand issues",
      "status": "backlog",
      "order": 1,
      "priority": "high",
      "labels": [],
      "skills": [],
      "source": "user",
      "created": "2026-02-01T09:00:00.000Z",
      "updated": "2026-02-01T09:00:00.000Z",
      "kind": "epic",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "## Goal\n\nA board linked to a repository with a thousand open issues syncs in under ten seconds.\n\n## Done looks like\n\n- One GraphQL round trip per page of issues.\n- No pull rewrites a card that did not change.",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0003-by-hand.md",
    "text": "---\ntitle: By hand\nlabels: [a, b]\n---\nBody",
    "canon": "---\nid: \"0003\"\ntitle: \"By hand\"\nstatus: backlog\norder: 0\npriority: normal\nlabels: [\"a\",\"b\"]\nskills: []\nsource: user\ncreated: \nupdated: \n---\n\nBody\n",
    "card": {
      "id": "0003",
      "file": "0003-by-hand.md",
      "title": "By hand",
      "status": "backlog",
      "order": 0,
      "priority": "normal",
      "labels": [
        "a",
        "b"
      ],
      "skills": [],
      "source": "user",
      "created": "",
      "updated": "",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "Body",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "0020-crlf-and-quotes.md",
    "text": "---\nid: 20\ntitle: 'Single quoted'\nstatus: review\norder: 2\npriority: urgent\nlabels: bug\nskills: ['a', \"b\", ]\nsource: Claude\nkind: \"gate\"\nowner:   pat  \nref: #7\ncustom: kept\n---\n\n\nFirst line.\n\nLast line.\n\n",
    "canon": "---\nid: \"20\"\ntitle: \"Single quoted\"\nstatus: review\norder: 2\npriority: normal\nlabels: [\"bug\"]\nskills: [\"a\",\"b\"]\nsource: user\ncreated: \nupdated: \nkind: gate\nowner: \"pat\"\nref: \"#7\"\ncustom: kept\n---\n\nFirst line.\n\nLast line.\n",
    "card": {
      "id": "20",
      "file": "0020-crlf-and-quotes.md",
      "title": "Single quoted",
      "status": "review",
      "order": 2,
      "priority": "normal",
      "labels": [
        "bug"
      ],
      "skills": [
        "a",
        "b"
      ],
      "source": "user",
      "created": "",
      "updated": "",
      "kind": "gate",
      "owner": "pat",
      "needs": "",
      "ref": "#7",
      "epic": "",
      "sprint": "",
      "body": "\nFirst line.\n\nLast line.",
      "remote": null,
      "extra": [
        "custom: kept"
      ]
    }
  },
  {
    "file": "0021-keys-in-any-order.md",
    "text": "---\n# written by hand\nupdated: 2026-01-03\nremote:\n  number: \"5\"\n  url: https://github.com/example/repo/issues/5\n  stray line under a known key\n  provider: bitbucket\nlabels:\n  - not\n  - read\ntitle: Keys in any order\nkind: task\norder: 03\nneeds:\nstatus: in-progress\nx-team: core\n  lead: kim\nid: \"0021\"\n---\nBody right after the rule.\n",
    "canon": "---\nid: \"0021\"\ntitle: \"Keys in any order\"\nstatus: in-progress\norder: 3\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: \nupdated: 2026-01-03\nremote:\n  provider: github\n  number: 5\n  url: https://github.com/example/repo/issues/5\n  updatedAt: \n  syncedHash: \n# written by hand\nx-team: core\n  lead: kim\n---\n\nBody right after the rule.\n",
    "card": {
      "id": "0021",
      "file": "0021-keys-in-any-order.md",
      "title": "Keys in any order",
      "status": "in-progress",
      "order": 3,
      "priority": "normal",
      "labels": [],
      "skills": [],
      "source": "user",
      "created": "",
      "updated": "2026-01-03",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "Body right after the rule.",
      "remote": {
        "provider": "github",
        "number": 5,
        "url": "https://github.com/example/repo/issues/5",
        "updatedAt": "",
        "syncedHash": ""
      },
      "extra": [
        "# written by hand",
        "x-team: core",
        "  lead: kim"
      ]
    }
  },
  {
    "file": "0022-no-id-no-number.md",
    "text": "---\ntitle: The id comes from the file name\nremote:\n  number: 0\n---\n",
    "canon": "---\nid: \"0022\"\ntitle: \"The id comes from the file name\"\nstatus: backlog\norder: 0\npriority: normal\nlabels: []\nskills: []\nsource: user\ncreated: \nupdated: \n---\n",
    "card": {
      "id": "0022",
      "file": "0022-no-id-no-number.md",
      "title": "The id comes from the file name",
      "status": "backlog",
      "order": 0,
      "priority": "normal",
      "labels": [],
      "skills": [],
      "source": "user",
      "created": "",
      "updated": "",
      "kind": "task",
      "owner": "",
      "needs": "",
      "ref": "",
      "epic": "",
      "sprint": "",
      "body": "",
      "remote": null,
      "extra": []
    }
  },
  {
    "file": "notes.md",
    "text": "# Notes\n\nNo frontmatter: not a card.\n",
    "canon": null,
    "card": null
  }
]
