# Capture recipes

A harness per kind of product. Each one meets `shot-contract.md`: a named shot, written by a script from the
built product in a set-up state, light and dark where the product themes, deterministic, isolated, cropped.
Pick the recipe by **what draws the pixels**, not by the backend language: a Django, axum, or Go server with a
web UI is the web recipe.

With perceptual-loop installed, any of these harnesses can double as its render command, and its baselines and
gates then catch a docs picture that changed when nothing should have.

## Web app (any backend)

Playwright against the built server, started by the harness's own config on its own port and database.

- **Reuse the end-to-end seams:** the server-start environment, the test-user sign-in, the fixtures. The
  harness is the second consumer of e2e, not a fork (`docs/capture/` imports from `e2e/support/`).
- **Config:** one browser, a fixed viewport (1440x900), `deviceScaleFactor: 2`, `locale` and `timezoneId`
  pinned, one worker, a `webServer` block that prepares a fresh database for the port then starts the server
  and waits on its health route.
- **Per test:** `page.clock.setFixedTime(...)`; `page.route(...)` to fake third parties; a scripted model or a
  stub service for anything nondeterministic behind the server.
- **The one helper,** `shot(page, name, opts)`:

```ts
export async function shot(page: Page, name: string, opts: { selector?: string; clip?: Clip; themes?: Theme[] } = {}) {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(name)) throw new Error(`shot name "${name}" must be "<section>/<name>"`);
  for (const theme of opts.themes ?? ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction((d) => document.documentElement.classList.contains("dark") === d, theme === "dark");
    await page.evaluate(() => document.fonts.ready);
    const settle = { animations: "disabled", caret: "hide" } as const;
    const png = opts.selector ? await page.locator(opts.selector).screenshot(settle)
                              : await page.screenshot({ ...settle, clip: opts.clip });
    write(`${IMAGES}/${name}${theme === "dark" ? ".dark" : ""}.webp`, await toWebp(page, png)); // canvas toDataURL("image/webp", 0.85)
  }
}
```

  `toWebp` draws the PNG onto a canvas in a scratch page and exports WebP; clip the canvas with `roundRect`
  first to bake rounded corners into the file. Python Playwright has the same calls (`emulate_media`,
  `clock.set_fixed_time`, `screenshot(animations="disabled", caret="hide")`).
- **Groups:** one `*.shots.ts` per docs area, one `test.describe("<group>")` each, run with `--grep <group>`.
  Data a group needs is created in its own `beforeAll`, named `docs-<group>-*`, and found again on a re-run.
- **Hiding transient UI:** `mouse.move(0, 0)`; `addStyleTag` to hide toasts; scroll so floating buttons leave
  the frame; replace on-screen secrets with `evaluate` before the shot.

## Desktop: Electron or Tauri

- Electron: Playwright's `_electron.launch({ args: ["."] })`, then `app.firstWindow()` is a `Page`, and the web
  recipe applies unchanged, `emulateMedia` included. Set the window size in the launch arguments.
- Tauri: `tauri-driver` (WebDriver, Linux and Windows) with WebdriverIO, or run the frontend's built assets in
  Playwright against a stub of the Rust commands when the shot is about the UI, not the native shell.
- Native menus and dialogs are drawn by the OS: describe them in text instead of photographing them.

## Command line and terminal UI (Rust, Python, Go, C++)

Text first: a terminal is text, and text diffs, searches, and copies.

- A generator script runs each documented command against a fixture directory with a pinned locale, time zone,
  width (`COLUMNS=80`) and `NO_COLOR=1`, and writes the output between markers in the page:
  `<!-- output: mytool export --help -->` ... `<!-- /output -->`. CI runs it with a check flag and fails on a
  diff: a derived copy with a drift test.
- Images only when colour or layout is the point (a TUI): VHS `.tape` files (`Set Width`, `Set Height`,
  `Set FontSize`, `Set Theme`, then `Screenshot <name>.png`), one tape per shot, run in CI's container so the
  font is the same everywhere. Light and dark are two `Set Theme` lines.

## Unreal Engine (C++)

The engine draws the pixels, so the harness is an automation test the editor or a packaged build runs
headless.

- **Where:** an automation test per docs area (`IMPLEMENT_SIMPLE_AUTOMATION_TEST` or an Automation Spec named
  `Docs.Shots.<Group>`), or a functional test map per area. One group runs alone through its test name.
- **Run:** `UnrealEditor-Cmd <Project>.uproject <Map> -ExecCmds="Automation RunTests Docs.Shots.<Group>; Quit"
  -unattended -nosplash -nopause -RenderOffscreen -deterministic -ResX=1440 -ResY=900`. `-RenderOffscreen`
  renders without a window (unlike `-nullrhi`, which renders nothing); `-deterministic` fixes the timestep and
  the random seed.
- **State:** load a fixed map, place the camera from a named actor or a recorded transform, set the time of
  day and every gameplay seed, spawn the fictional cast's data, and wait for shader compilation and streaming
  to finish (poll the shader compiler's remaining-jobs count and the level-streaming state) before the first
  frame.
- **Settle the renderer:** `r.MotionBlurQuality 0`, fixed exposure (disable auto-exposure in the post-process
  volume, or `r.EyeAdaptationQuality 0`), and render warm-up frames so temporal anti-aliasing history has
  converged. Functional tests can use `TakeAutomationScreenshot` with `FAutomationScreenshotOptions`
  (`bDisableNoisyRenderingFeatures`), which also gives the engine's own comparison against a ground truth.
- **Capture:** `FScreenshotRequest::RequestScreenshot(Path, /*bShowUI*/ false, /*bAddFilenameSuffix*/ false)`,
  or `HighResShot 2` for a 2x capture of the game viewport. Editor UI (a details panel, a custom tool):
  `FSlateApplication::Get().TakeScreenshot(Widget, Pixels, Size)` on the widget, so the crop is the widget.
- **Themes:** the editor ships one theme; set `"themes": ["default"]` (one image per shot) unless the project
  defines a light editor theme and documents both.
- **Output** goes to `Saved/` first; a small post-step converts to the project's format and moves it into the
  docs images folder, writing the shots manifest.

## Native C++ desktop (Qt, wxWidgets, ImGui)

- Qt Widgets: a test binary builds the window in a set-up state and calls `QWidget::grab()`; run it with
  `QT_QPA_PLATFORM=offscreen` and `QT_SCALE_FACTOR=2`, the Fusion style, and a bundled font
  (`QFontDatabase::addApplicationFont`). Dark is a second palette. QML: `QQuickItem::grabToImage`.
- Dear ImGui: the ImGui Test Engine's capture tool, or render a fixed number of frames into an offscreen
  framebuffer and read it back (`glReadPixels`), with `io.DeltaTime` fixed.
- wxWidgets and Win32: draw the window into a memory device context in a test binary; when that is not
  possible, describe the UI in text and photograph only what the product draws itself.

## Python notebooks and plots

- Execute notebooks with `nbclient` (or `jupyter nbconvert --execute`) against fixture data with a seed.
- Matplotlib: the `Agg` backend, one style file for the docs, `savefig(dpi=2 * base_dpi, metadata={"Software":
  None})` so the bytes do not change by version, and `rcParams["svg.hashsalt"]` fixed for SVG. A dark variant
  is a second style file and a second save.

## Mobile simulators and emulators

- iOS: `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100 --cellularBars 4`,
  `xcrun simctl ui booted appearance dark|light`, then `xcrun simctl io booted screenshot <file>.png`, driven by
  the UI-test target that sets the state.
- Android: system UI demo mode for a clean status bar, `adb shell cmd uimode night yes|no` for the theme,
  `adb exec-out screencap -p > <file>.png`, driven by an instrumentation test.
- Flutter: `integration_test`'s `takeScreenshot`, with the clock and theme set in the test.

## Libraries and APIs with no UI

No screenshots. The same parity rule holds through executable examples:

- Examples on a page are compiled or run by the test suite: Python `doctest` or a test that imports the page's
  snippets, Rust `cargo test --doc` and `examples/` built in CI, C++ example targets built in CI.
- HTTP request and response examples are recorded from the integration tests into snippet files the pages
  include, so a changed payload changes the page in the same run.
