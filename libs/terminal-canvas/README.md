# terminal-canvas — how much picture fits in a terminal

Drawing pixels into a text terminal — for any app that shows a picture, or
wants to compare what each technique can do on the terminal it is running in.

The TUI side lives with the rest of the UI kit: `ui/components/GraphicsCanvas`
draws a subject with a text technique (and reserves the blank rectangle a raster
one needs), and `ui/hooks/useRasterOverlay` paints a kitty/sixel/iTerm2 image
over that rectangle after Ink has drawn its frame. Probe the terminal with
`probeGraphicsSupport()` *before* handing stdin to Ink; read the cached answer
with `graphicsSupport()` afterwards.

## Using it

Every technique is built from a *terminal footprint* (cols × rows) and exposes
the same `set(x, y, r, g, b)`, so one piece of scene code drives all of them:

```ts
import { createHalfBlockCanvas, renderSphereScene } from "@/dev-tools/terminal-canvas";

const canvas = createHalfBlockCanvas(60, 20);   // 60x40 pixels in 60x20 cells
renderSphereScene(canvas, { time: 0.9 });
console.log(canvas.render());
```

Swap `createHalfBlockCanvas` for `createBrailleCanvas` and the same code draws
at 120×80 in the same rectangle. That shared footprint is what makes the
comparison view honest — and what keeps a raster protocol the same size on
screen as the text techniques.

## The ladder

| # | Technique  | Pixels/cell | Colours/cell | Needs                          |
|---|------------|-------------|--------------|--------------------------------|
| 1 | ASCII ramp | 1           | 0            | nothing                        |
| 2 | ANSI 16    | 1           | 1            | any terminal                   |
| 3 | Truecolor  | 1           | 1 of 16.7M   | truecolor (universal now)      |
| 4 | Half block | 2           | 2            | truecolor + U+2580             |
| 5 | Sextant    | 6           | 2            | Unicode 13 font coverage       |
| 6 | Braille    | 8           | 1            | braille font coverage          |
| — | Raster     | unlimited   | unlimited    | kitty / sixel / iTerm2         |

**Half-block is the sweet spot.** Square pixels, full colour, no font or
protocol risk, and it composes with a text layout engine because it is still
text. Rungs 5 and 6 buy resolution by giving up colour or portability.

## Files

- `pixelCanvas.ts` — the `PixelSurface` / `PixelCanvas` interfaces. Everything
  is constructed from a terminal footprint (cols × rows) so techniques can be
  compared in an identical rectangle.
- `createCellCanvas.ts` — rungs 1–3, mode-switched.
- `createHalfBlockCanvas.ts`, `createSextantCanvas.ts`, `createBrailleCanvas.ts`
  — rungs 4–6.
- `createRasterCanvas.ts` — plain RGBA buffer for the protocol path.
- `renderSphereScene.ts` — the shared test scene: smooth gradient (exposes
  colour depth), high-frequency checker (exposes resolution), specular
  highlight (exposes both).
- `drawLine.ts`, `drawImage.ts`, `joinBlocks.ts`, `runAnimation.ts` — support.
- `subjects.ts` — what there is to draw: the shaded ball, the wireframe globe,
  and `loadImageSubject` for any PNG an app brings. `techniques.ts` — the ladder below, as data, plus which
  rungs a given terminal can reach.
- `renderSubjectPanel.ts` — one subject × one technique → terminal rows.
  `renderTechniqueComparison.ts` — every text technique at once, tiled.
  `fitFootprint.ts` — the cell rectangle that keeps a subject's shape.
- `detectGraphicsSupport.ts` — queries the terminal rather than guessing from
  `$TERM`.
- `encodeKittyImage.ts`, `encodeSixelImage.ts`, `encodePng.ts` — the wire
  formats.
- `decodePng.ts` — full PNG decoder (bit depths 1–16, all colour types,
  palettes, `tRNS`; rejects Adam7 interlacing rather than guessing).
- `resampleImage.ts`, `flattenImage.ts` — box-filter resize and alpha
  compositing, both needed before any real image can reach a terminal.

## Things that cost time to discover

- **`pixelAspect` is not cosmetic.** A terminal cell is about 1 wide by 2 tall.
  Half-block and braille subpixels come out square; a whole-cell pixel does not.
  Without correcting for it, every circle renders as an ellipse.
- **Sextants skip two codepoints.** Patterns 21 and 42 are not in the
  U+1FB00 block — they already exist as `▌` and `▐` — so every value above them
  shifts down by one.
- **Braille bits are not in raster order.** Dots 7 and 8 (0x40, 0x80) were
  appended to a 6-dot standard, so the bottom row is discontinuous with the rest.
- **`Bun.deflateSync` emits raw DEFLATE**, byte-identical to node's
  `deflateRawSync`, with no option to change it. PNG's IDAT needs a zlib
  container, so `encodePng.ts` adds the 2-byte header and Adler-32 itself. A PNG
  without them still passes a CRC check and still fools `file`, which only reads
  IHDR — then fails in every real decoder.
- **Sixel needs `P2=1` in the DCS introducer.** Under the default `P2=0` a 0 bit
  paints the *background* colour. Only one colour is active at a time, so a band
  is drawn once per colour — and each pass then erases the ones before it. The
  image arrives blank except for whichever colour was written last. The header
  must be `ESC P 0;1;0 q`, not `ESC P q`.
- **A round-trip test cannot catch a header bug.** The P2 mistake above survived
  a byte-exact round trip because the test decoder shared the encoder's wrong
  assumption. `terminalCanvas.test.ts` now models P2 and asserts on it, plus a
  guards-the-guard test that rewrites the header to the buggy value and checks
  the decoder notices.
- **The three raster protocols do not size images the same way.** kitty (`c=`/
  `r=`) and iTerm2 (bare `width=`/`height=`) scale into a box measured in
  *cells*, so they self-correct. Sixel has no cell concept and lands at one
  device pixel per image pixel. If the cell size is wrong, sixel comes out a
  different size from the other two — which is why `detectGraphicsSupport.ts`
  falls back from `CSI 16 t` to `CSI 14 t ÷ grid` before it will guess.
- **Kitty payloads must be chunked** at 4096 base64 bytes, and animation must
  delete the previous image (`a=d`) or placements accumulate until the terminal
  stalls.
- **Ink needs one `<Text>` per canvas row.** A single multi-line `<Text>` under
  `wrap="truncate"` collapses to one line, because cli-truncate treats the whole
  string as one.
- **Raster protocols do not compose with Ink.** Ink measures the escape
  sequences as zero-width and paints over them. That path needs a reserved empty
  `<Box>` plus direct stdout writes.
- **`Bun.inflateSync` is raw INFLATE**, symmetric with `deflateSync`, so
  `decodePng.ts` strips PNG's zlib container by hand — two bytes off the front,
  four off the back.
- **A terminal has no alpha channel.** Transparency must be composited before
  drawing or the RGB stored under invisible pixels shows up as-is; `moon.png`
  keeps white there, which paints a white box on a dark terminal.
- **Resample with alpha weighting.** Averaging the colour under transparent
  pixels puts light halos along every edge. `resampleImage.ts` accumulates
  premultiplied and un-premultiplies at the end.
- **Reserve rows before drawing an image inline.** Print the newlines first, then
  move the cursor back up: the scroll happens before the position is saved, so
  the image still lands correctly at the bottom of the screen.

- **Trust the terminal's answer over your own guess.** `detectGraphicsSupport`
  used to OR an environment heuristic on top of the DA1 reply, so Ghostty —
  which correctly reports *no* sixel, since it implements the kitty protocol
  instead — was sent sixel anyway and showed a blank rectangle. A capability
  probe that can be overridden by a guess is not a probe.

## Verified

`bun test libs/terminal-canvas` covers the sixel round
trip (against an independent decoder that models P2, plus a test that rewrites
the header to the buggy value and checks the decoder notices), the PNG zlib
stream, decoding a real PNG that uses all four scanline filters, kitty chunking
and image ids, and the braille/sextant glyph tables.
