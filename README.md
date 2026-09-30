# Reel Editor

A browser video editor for silent Instagram Reels. Output is 1080×1920 at 30 fps, H.264 MP4, with no audio.
Everything runs locally in the browser. Nothing is uploaded.

**Supported browser:** desktop Chrome or Edge.

## Status

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Upload, crop, auto-trim | ✅ done |
| 2 | Photos and Ken Burns | ✅ done |
| 3 | Text reveals and gradient overlay | ⏳ |
| 4 | Timeline and preview | ⏳ |
| 5 | Export | ⏳ |

## Run it

```bash
npm install     # also copies the MediaPipe runtime into public/
npm run dev     # http://localhost:5173
```

## How Stage 1 works

- **Import.** You can import MOV, MP4, WebM, HEIC, JPG, PNG and WebP by drag-and-drop or the *Add media* button. Files are demuxed with [Mediabunny](https://mediabunny.dev) and decoded with WebCodecs. HEIC photos are decoded with libheif (WASM). Rotation from the .MOV metadata and EXIF/HEIF orientation are applied, so everything shows upright.
- **HDR.** iPhone HDR (10-bit BT.2020 HLG), and PQ/HDR10, are converted to SDR by a WebGL shader when the browser exposes the raw 10-bit frame (`src/gl/shaders.ts`, with the math mirrored and unit-tested in `src/gl/color.ts`). The conversion follows BT.2100, maps BT.2408 reference white (203 nits) to SDR white, compresses highlights smoothly, and converts BT.2020 colors to BT.709. When the browser only gives a GPU-backed frame, Chrome's own tone mapping is used instead.
- **Crop.** Every source is scaled to fill 9:16. Drag the preview to reposition and scroll (or use the slider) to zoom. When a face is detected, the default crop centers on it.
- **Auto-trim.** Each video is sampled about 10 times per second. Every sample is scored for:
  - focus (Laplacian variance)
  - exposure
  - how clear the subject is
  - faces (MediaPipe, running on your machine)
  - motion within the scene
  - camera shake (jitter in the estimated camera motion)

  A 1.5–2.0 s window slides across the clip, and the best-scoring window is picked. Each window's score blends its average quality with its worst frame, so a single blurry moment sinks it.
- **Learning.** When you move a pick, the app compares your section's scores with the auto pick's. It shifts the weight of each factor accordingly and also records where in the clip you tend to pick and how long you like picks to be. Future videos use what it learned. The *Learned preferences* panel shows the result and has a reset button. Everything is stored in this browser only.
- **Autosave.** The project, your original files, analysis results and learned preferences are saved in IndexedDB.

## How Stage 2 works

- **Length.** Every photo lasts exactly 1.5 s, which is 45 frames at 30 fps.
- **Ken Burns.** Each photo gets one of four moves: *zoom in*, *zoom out*, *pan left* or *pan right*. The default is zoom in.
  - The moves are subtle. Zooms change by 7%, and pans travel about 4.5% of the frame width at 1.06× zoom.
  - They use sine ease-in-out easing, so the motion starts and stops smoothly.
  - The last frame lands exactly at the end of the move.
- **Framing.** The move happens inside your crop, so it never shows anything outside the framing you chose.
- **Previewing.** Picking a move plays it. You can also scrub the 1.5 s bar under the preview, or use *Play*.
- **Apply to all.** *Use this move on all photos* copies the current photo's move to every photo.
- **Shared geometry.** The math lives in `src/kenburns.ts`. `src/render/layout.ts` is the single place that decides what part of the source each frame shows, and preview and export will both use it.

## Tests

```bash
npm test            # unit tests (crop math, HDR math, metrics, scoring, learning)
npm run fixtures    # generate test media (needs ffmpeg, heif-enc with x265, python3 + numpy)
npm run e2e         # Playwright end-to-end tests in Chromium
```

The test media are VP9 files. The open-source Chromium used for automated tests can't decode H.264 or HEVC through WebCodecs, although Google Chrome and Edge can.
