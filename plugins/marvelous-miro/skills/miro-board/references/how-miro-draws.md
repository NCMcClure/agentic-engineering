# How Miro draws, and the rules a generator follows

Each rule here is a fix a legibility pass once made by hand. The lint (`scripts/lint.mjs`) enforces the layout ones, so a generator that breaks one fails the build instead of reaching the board. Read this before laying out a new generator, and again when a lint finding's name is not self-explanatory.

## Connectors

- **A connector attaches at the middle of the side it names, and its caption sits at the middle of its route**, `tw(text, 14) + 8` wide and 1.45 of its font size tall, turned to run along a vertical segment. Connectors sharing a side share a trunk, which is fine while each caption's box stays clear of the other connectors' routes and captions (`caption_collision`). When it cannot, put the meaning on the card the connector serves instead, as the card's first body line (`submit →` on a caller, `→ assess` on an output).
- **A caption needs a straight run longer than itself, with room on both sides of the route's midpoint**, or it hangs over the bend (`caption_run`, which says how far past the run's end it reaches). On an elbow whose legs differ in length the midpoint can sit close to a bend, so a caption shorter than its run can still overhang. A short connector, like one between two bands, gets its words as a text item beside it, not a caption (`label_card`, `label_text`).
- **Straight only when the two boxes' centers line up**, or Miro draws it diagonal (`diagonal`). `miro.mjs` already writes every other connector as elbowed; a generator only has to line centers up where it wants a straight run.
- **Miro routes an elbowed connector itself**: facing sides bend once in the middle (or not at all when the ends line up), the same side on both ends takes a 30px detour, perpendicular sides take one corner, and none of them steers around a card in the way. Miro never leaves or enters a side on a leg under 30px: where the default route would (facing sides under 60px apart, or a perpendicular corner closer than 30px to a side), it takes a 30px stub and crosses through the middle of the gap between the two boxes on the other axis. The build predicts that route to lint it. Findings are marked `(est)` only where the prediction is known to miss: a perpendicular elbow whose corner path meets a box (Miro detours), a leg under 1px along the boxes' sides, and a path back through one of its own end boxes. The live check sees the real route.
- **Keep a connector 6px off cards it passes** (`line_near`, `line_card`), off other connectors' runs (`line_line`), and 20px from any connector it runs beside for more than 20px (`line_parallel`). Connectors that share no end do not cross (`line_cross`): one passing to the other side of another counts, including through a bend or out of a short stretch the two share, and a bend that only touches another route and turns back does not.
- **On a strict frame, the main flow reads right or down**: at least 80% of the solid, one-headed connectors end at a box to the right of or below their start box (`direction`). A connector reads backward only when its end box's center is above, left of, or above and left of its start box's, so a fan-out down to a box far to the left still reads down, and a call back along a row or a loop can stay within the other 20%. Dashed and two-headed connectors are side traffic and do not count.

## Text

- **Shape text is Arial, 8px in from each edge, line height 1.2.** `overflow` means it does not fit; widen the card rather than shrinking the font. `scripts/measure.mjs` holds these metrics: `measureHtml` is what the lint measures with, and `autosize(title, body, { maxW })` returns the smallest card that holds them.
- **A card renders all its text at its smallest font size**, so a subtitle set smaller drags the title down with it. Fold the subtitle into the body instead.
- **A text widget is drawn from its `y`, 1.143 of its font size tall per line**, and a taller height pulled from the board does not make it taller. The build sends every text widget at that height: a widget sent with no height gets one the canvas tool guesses, and Miro centres the text in it, so a 40px title once landed 33px below its `y`. Stack text with room for that: a 40px title needs about 56px before the next line (`text_text`).

## Spacing and frames

- **Unrelated things keep 10px apart** (`gap`, `card_card`); everything stays inside its frame (`outside_frame`), and frames keep their distance (`frame_frame`).
- **A card sits wholly inside its band or group box, or wholly outside it** (`card_border`), never across the border.
- **A legend lists exactly the styles in use** (`legend_coverage`). Its entries are swatches (a box at most 40 by 30 with no text) and line samples (a divider at most 60 long), each with its label starting within 24px to its right. Swatches cover the stroke colors of the cards and pills that carry text: a lighter fill of a listed stroke is that style, and a borderless tint (stroke the same as its fill) is a backdrop. Line samples cover solid and dashed connectors. Each kind is checked only when the legend shows one, and only by the build: the live dump carries no styles.
- **A pipeline stays on one row**: a connector wrapping to the next row is drawn with a jog through the cards between.
- **A card's pill sits bottom-right**, clear of the title (`badge_text`).
- **A card placed into a frame the board already laid out** is drawn in free scene space and given its board position with `boardAt`, so its text is never grouped into another card; the lint then checks it against the board's real layout.

## What the Miro MCP does that the scripts already handle

These explain errors you may see, so you do not work around them by hand:

- Miro sizes a frame before it moves the frame's children, so shrinking a frame in the same update fails with "child widget cannot be placed outside the bounds". The build sends the frame at its old size and writes `<frame>.resize.svg` to send after.
- Miro resolves a connector's ends only among items in the same document ("connector endpoint unresolved"). The build includes both ends of every changed connector.
- An update restates a connector whole: the build sends `data-content=""` to clear a caption that was removed.
- Ids Miro creates are not contiguous, and in a read, connectors sit outside their frame's `<g>`. `pull.mjs` matches by key on a create result, and by position and ends with `--adopt`.
- Miro escapes caption entities twice (`&amp;#39;`); `pull.mjs` decodes them before matching.
- A caption's `textAlignVertical` (top or bottom) moves it beside the line rather than on it; the dump and the lint both account for that.
