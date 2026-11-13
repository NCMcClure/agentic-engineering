# The model

`model.json` sits beside every figure. It is what the figure draws, what the
three drafts share, and what a later session starts from. It says what the
subject is, never how to draw it: no positions, no sizes, no view. `model check` holds
it to the rules below.

```json
{
  "schema": 1,
  "title": "How an upload becomes a thumbnail",
  "mechanism": "The API hands each upload to a queue, and a worker takes the jobs off it one at a time.",
  "lens": "path",
  "claim": "The API answers before the slow work starts, so an upload never waits on it.",
  "implication": "When thumbnails fall behind, add workers, not API servers.",
  "entities": [
    { "id": "api", "label": "API", "kind": "service", "note": "answers at once", "source": "src/api/upload.ts:41" },
    { "id": "queue", "label": "Jobs", "kind": "queue", "note": "holds the work" },
    { "id": "worker", "label": "Resizer", "kind": "worker", "hue": "blue" }
  ],
  "flows": [
    { "id": "enqueue", "from": "api", "to": "queue", "kind": "event", "label": "job" },
    { "id": "take", "from": "queue", "to": "worker", "kind": "event" }
  ],
  "beats": [
    { "id": "answer", "title": "Answer first", "plain": "The API hands the job to a queue and replies right away.",
      "technical": "POST /upload enqueues a resize job and returns 202.", "focus": ["api", "queue"], "flows": ["enqueue"], "ms": 3200 },
    { "id": "work", "title": "Work later", "plain": "A worker picks the job up when it is free.",
      "technical": "The resizer takes one job from the queue.", "focus": ["queue", "worker"], "flows": ["take"], "ms": 3000 },
    { "id": "rest", "rest": true, "focus": [], "flows": [], "ms": 1400 }
  ],
  "hero": { "beat": "work", "at": 0.5 }
}
```

## The fields

- **`mechanism`**: what happens, in one sentence with a verb, at most 160
  characters. It comes from `lenses.md`, question two.
- **`lens`**: the kind of explanation this is: `structure`, `path`, `time`,
  `field`, `transformation`, `difference`, `cases` or `scale`. `draft new`
  will not start a round without the mechanism and the lens.
- **`claim`**: one sentence, at most 140 characters: why this matters. Not a
  description of the picture. "Uploads never wait on resizing", not "This
  figure shows the upload flow".
- **`implication`**: what follows from it. Shown while the loop rests.
- **`entities`**: two to nine. `label` is what is drawn (keep it under 28
  characters); `note` is a few words under it (at most 36); `kind` picks the
  shape (`client`, `service`, `worker`, `queue`, `store`, or your own word);
  `hue` marks at most four of them, to tell them apart; `group` sorts them
  into sides for an A/B figure (every entity, or none).
- **`flows`**: what passes or changes between two things. A structure figure
  may have none. `from` and `to` are entity ids; `kind` is one of `write`
  (changes something), `read` (asks and gets an answer back), `event`
  (tells), `query` (looks). `label` is the word on the wire.
- **`beats`**: two to seven that tell the story, then exactly one `rest` beat.
  `focus` is what the beat is about; `flows` is what moves in it; `ms` is how
  long it holds (1200 to 8000). `plain` is the caption, at most 140
  characters. `technical` is on every beat or none.
- **`hero`**: the beat, and the point in it, that the still is taken at. Pick
  the beat a reader should see if they see only one.
- **`source`**: `path:line`, on an entity or a flow, when it was read from code.

## More than things and flows

Not every subject is things with flows between them. Five further fields,
each optional, describe the rest. Use the ones the subject has; a model with
none of them is as valid as it ever was.

```json
"entities": [
  { "id": "parent", "label": "Shell", "kind": "process" },
  { "id": "child", "label": "Build", "kind": "process", "parent": "parent", "born": "fork" },
  { "id": "worker", "label": "Worker", "kind": "thread", "parent": "child", "repeat": 4 }
],
"quantities": [
  { "id": "queued", "label": "Jobs queued", "of": "child", "unit": "jobs", "max": 8,
    "values": { "fork": 6, "drain": [6, 3, 0] } }
],
"data": {
  "jobs": [{ "id": "j1", "label": "compile a.c", "of": "worker", "at": "drain" }],
  "heat": [[0, 1, 2], [1, 2, 3]]
}
```

- **`parent`**, on an entity: the entity it is inside, or was started by. A
  part in a case, a row in a table, a process a process forked. Nothing is
  inside itself.
- **`born`**, on an entity: the beat it comes into being in. It is absent
  before that beat in every draft, and no earlier beat may be about it. Left
  out, the thing is there from the start.
- **`repeat`**, on an entity: how many of it are drawn, 2 to 24. Many of a
  thing is drawn as a few: four workers standing for forty.
- **`quantities`**: up to four numbers that change as the story is told: how
  full, how many, how far. `values` names beats. One number is where the
  quantity stands when that beat ends, reached evenly from where it stood. A
  list of two to eight is its course through the beat, evenly spaced, and
  its first value may jump from the last beat's: a buffer that empties at
  once. A beat left out holds the level. `max` is its limit, which a meter
  is drawn against; `start` is where it stands before the first beat; `of`
  is the entity it measures. A figure reads it with `f.level` and `f.share`.
- **`data`**: up to eight named tables a view lays out, at most 600 values
  in all. A table is one of three kinds: a list of numbers (a series); rows
  of numbers, all the same width (cell values); or rows of named values
  (units of work, the turns of a transcript). In a row, `of` must name an
  entity, `at` a beat, and an `id` is unique in its table; every other key
  is the view's own. Data is what all three drafts must agree on. A number a
  single draft needs for its layout stays in that draft.

Which lens tends to need which: structure and scale use `parent`; time uses
`born`, `repeat` and `quantities`; field uses `data` as cells;
transformation uses `data` as rows, before and after.

Every entity must be in some beat and every flow must be told by some beat.
The whole loop runs at most 30 seconds.

The flow a beat leads with is the one that arrives furthest along: its target
is the one thing that beat is about, and it takes the accent. Order entities
the way the story travels, so that is the right one.

## From a description

Write the model, run `model check`, and go on to the drafts. Show the model
beside them, so the person can see what was drawn from.

## From code

Read the feature before writing anything: its entry point, what it calls,
what it writes, what comes back. Then:

1. Write the model with a `source` on every entity and every flow, and run
   `model check --require-source`. A source is the line where the thing is
   defined or the call is made, not the top of the file.
2. Show the person the model as a short plain-language list: the things, what
   passes between them, the beats in order, the claim. No JSON.
3. Wait for a yes. Reading code wrong is the main risk here, and a wrong model
   drawn three ways is three wasted drafts.

Name things the way the code does in the technical captions, and the way a
person would in the plain ones. Leave out what the claim does not need:
logging, retries, configuration, unless one of them is the point.
