# Wdrunge frontend

React + Vite frontend, also packaged with Tauri. Run `npm install` and `npm run dev` for the browser, or `npm run tauri:dev` for the desktop window. Start the Python API separately as described in the root README.

The frontend calls `http://127.0.0.1:17420` by default. Set `VITE_API_BASE_URL` to use another backend address.

API types and the ordinary HTTP SDK in `src/generated/` come from FastAPI's OpenAPI schema. After changing backend models or endpoints, run:

```sh
cd ../backend && uv run python -m scripts.export_openapi
cd ../frontend && npm run api:generate
```

Use the generated types for requests and responses. The chat endpoint uses a small custom `fetch` wrapper in `src/api.ts` to read POST-based SSE frames incrementally.

## 3D office

Click a role name to open its action review card. Each role can independently follow real agent status or loop one supported action, with pause/resume, restart and a scrubber for inspecting the ending. Manual review simulates the necessary running/idle status locally and updates that character's screens; it does not write backend agent status. Gaming remains limited to backend/testing, and drawing to the designer. Close the card without losing the selection, or choose “跟随真实状态” to restore status-driven behavior. These temporary selections reset on page reload.

`OfficeScene.tsx` renders an orthographic rear view using WebGL, rounded 3D furniture, ambient occlusion, and soft VSM shadows. The continuous, subtly textured floor fills the viewport; there is no raised platform edge. Workstations use two columns and three rows with open centre and cross-aisles.

`DeskScene.tsx` defines the six role-specific models (including the designer's drawing tablet, frontend dual monitors, and backend triple monitors). `ScreenSurface.ts` gives every display its own texture and `update(elapsed, state, animate)` interface. The screen contents are illustrative, not live source files or actual service metrics. Agent status drives their running/idle/failed presentation. `ScreenAnimations.ts` supplies progressive code edits, scrolling logs, animated test runs, drawn strokes, moving planning cards, and live page previews. During gaming, only the backend centre monitor shows the arena game and only the testing main monitor shows the racing game; auxiliary displays keep work content. Returning to work or failing immediately clears the game. Screen and character animation share the paused simulation timeline. A future preview or video texture can replace an individual display without rebuilding its desk.

`OfficeCharacter.ts` adds seated characters with role-specific clothing and hair. `CharacterBehavior.ts` maintains a persistent probability-based scheduler per character rather than a fixed playlist. At each completed work bout it chooses typing (65%), mouse (27%), stretching (5%) or drinking (3%); the designer chooses drawing (92%), stretching (5%) or drinking (3%). Work starts at a tool. Daytime idle choices favor rest (60%, or 64% for non-gamers), then phone (14%), sleep (6%), stretch (9%), drink (7%) and gaming (4%, eligible roles only). Rest lasts 4–7 seconds, with at most two consecutive rest bouts before a weighted choice among other activities; small head, shoulder and hand adjustments keep rest visibly alive. Night idle retains the quieter rest (68%/71%), phone (12%), sleep (8%), stretch (5%), drink (4%) and gaming (3%) weights and 18–32 second rest bouts. Work bouts last 18–32 seconds and mouse bouts 7–12 seconds; prop actions keep their authored durations. Repeated status events never restart a bout. Only backend and testing can game, using the left hand on the keyboard and the right on the mouse simultaneously; ordinary work still alternates input devices. Cup and palm share a fixed grip during pickup and drinking; stretching follows an outward arc with continuously blended elbow and wrist poses. Work clips ease into and out of a common resting pose; live status/manual-mode interruptions blend over 0.9 seconds. Night sleep follows the scene clock (22:00–08:00): once an idle character falls asleep, the settled pose holds with breathing until a real task wakes them or morning arrives. At 08:00, sleepers rise, stretch once, then rest. Manual review bypasses this sleep latch and returning to real status resets it.

`WorkAnimation.ts` keeps a separate work and editing timeline for each role. Code advances line by line without clearing on a short loop, resumes after mouse use, and scrolls continuously. Frontend code and its preview share build revisions: a completed change updates the preview title, theme and card layout. Tablet brush coordinates share the physical pen path. Gaming eases in from rest, releases both hands over its final 1.4 seconds, and fades the game back to the work screen; the mouse stays on the desk throughout.

Characters animate during work and idle at up to 30 fps; dynamic shadows refresh at up to 15 Hz. Rendering stops when paused, hidden, or offscreen, and respects the system's reduced-motion preference. Scene teardown releases geometries, textures, shadow maps, postprocessing targets, and listeners.

`OfficeDaylight.ts` supplies a simulated 24-hour lighting cycle and a physical analog clock on the front cabinet. The clock and lighting follow the computer's local time by default, including automatic dawn, daylight, dusk and night changes. Click the clock to switch to a fixed time, scrub through the day, choose a dawn/noon/dusk/night preset, play a fifteen-minute day, or return to system time. Sun direction, intensity and color temperature vary continuously. Night reduces ambient lighting and adds restrained screen bloom and local cool light on desks and characters. The directional floor bake is no longer used, so shadows move with the sun without a stationary duplicate. This is an artistic simulation, not a geographic sun calculation.

Station labels and the clock readout fade through neutral grey into their night colors, including on manual time jumps and when character animation is paused; there is no binary day/night color threshold.

For visual regression checks, start Vite and open `http://localhost:1420/dev/office.html`. This development-only fixture provides role-state, action, animation, width, and mount/unmount controls without sending a chat request or changing backend state. Pause a selected action to inspect a specific time. It is not included in the production entry point.

Run `npm run test:characters` to verify behavior guards, input exclusivity, stretch joint continuity (including the loop seam), and the cup/palm grip using the actual Three.js rig without WebGL. Only canvas screen painting is stubbed.

`npm run test:office` runs the same suite, including weighted action distributions, continuous work bouts, overnight sleep, task wake-up, morning stretching, daylight continuity, midnight wraparound, clock hands, game eligibility, dual-hand placement, screen animation, pause caching and game/work transitions.
