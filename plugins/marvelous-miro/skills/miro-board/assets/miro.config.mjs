// The diagrams this project keeps on its Miro board. Every marvelous-miro script reads
// this file; the board's ids and layout live in miro/ beside it, written by build and pull.
export default {
  board: "{{BOARD_URL}}",
  views: [
    // key: a word that prefixes every item key; title: the frame's title on the board;
    // gen: the generator; grid: true to take the next grid slot until the board places it;
    // strict: true when the generator alone lays the frame out, so every lint finding blocks.
    { key: "example", title: "Example pipeline", gen: "./src/gen-example.mjs", grid: true },
  ],
  // Where grid frames go before the board places them.
  grid: { x: 0, y: 0, cols: 3, gap: 200 },
};
