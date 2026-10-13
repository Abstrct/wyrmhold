# The Proving Ground — Wyrmhold's QA framework

> One player wrote: *"The game seems to have issues with my Ghoul Archer. It doesn't appear on the map and
> when I click it from the list that I own, it black screens."* That report was true, it had been true for
> every Ghoul Archer on the ledger (224 of them), and nothing in the project would have caught it. This
> framework exists so that the next one is caught before a player ever sees it.

The proving ground is a self-contained test rig in `qa/`. It needs nothing the repo does not already have:
Node 22+ and a Chrome on the machine. It starts a **mock ledger** it fully controls, serves the game against
it, drives **headless Chrome with software WebGL** over the DevTools protocol, and runs thirteen suites that
together cover what a studio's QA department covers: art, logic, stability, every screen, player journeys,
clarity, accessibility, devices, resilience and performance. Every run writes a report with evidence.

```bash
pnpm qa                       # everything (about 105 minutes under software WebGL)
pnpm qa hold assets           # named suites
pnpm qa --list                # the suites
node qa/run.mjs smoke --headed --keep       # watch it; leave the servers up afterwards
node qa/run.mjs logic --net                 # also diff the shipped catalogue against the public ledger
```

Reports land in `qa/reports/<timestamp>/` as `report.md`, `report.json` and an `evidence/` folder of
screenshots. The exit code is non-zero when any S0 or S1 check fails.

---

## 1. What a game studio tests, and what that means for Wyrmhold

A studio's QA is organised around *what can go wrong for a player*, not around the code. The pillars below
are the ones every shipped game is tested against; under each is what it means for Wyrmhold specifically
and which suite carries it.

| Pillar | The question | For Wyrmhold | Suite |
|---|---|---|---|
| **Art & asset validation** | Does every model load, measure, animate and render? | 22 procedural beasts and hallows plus Ysolde, each built from code at runtime. A NaN in one vertex sank the Ghoul Archer. Every body is built in a real WebGL context, scanned for non-finite coordinates at rest and after animation, measured against a size and triangle budget, then rendered on the dais with shader output watched for warnings. | `assets` |
| **Game logic & data integrity** | Are the rules and the data the client ships correct and consistent? | The struct catalogue (22 types), the lore names, the realm↔ambit mapping the scenes use, the reach bitmasks, the action rules (`verbsFor`, `buildBlock`, `freeCircle`), unit placement (`unitsOf`), event routing, formatting, the chant difficulty clock, and `--net` drift against the public ledger. | `logic` |
| **Smoke & stability** | Does every screen boot, draw and leave cleanly? | Eight entry points as a stranger and seven as a sworn warden: no thrown error, no console error, the sky's first frame drawn and not black, the camera finite, deep links honoured, and a walk of every road twice leaving no stray scene, canvas, tag box or dialog. | `smoke` |
| **Feature / functional** | Does each screen do what it says? | The Hold (roster ↔ isle parity, selection, the card, filters, rites, Summon, Guard, omens, watching, crowds, unknown types), the Bestiary (22 runes), the Skirmish (both warbands, reach vs the catalogue, the war bar, dodge odds as the ledger rolls them, guards named, riding out, Unleash and Fight on as real rites, the fray, the plunder chant waiting on their Wyrm, defending), the Atlas, the Leyweave and the Grimoire. | `hold` `bestiary` `skirmish` `atlas` |
| **Player journeys (end to end)** | Can a new player get from nothing to playing? | A browser that has never seen the game: the prologue, the oath start to finish against a mock coven scribe, the first Hold with the tour and Ysolde's path, a summoning that queues, signs, broadcasts and appears on the isle, the Chronicle, and forgetting the soulstone. | `flows` |
| **Clarity, text & localisation** | Does the player understand what they read? | Wyrmhold has a strict tongue: never a ledger id, never an engine word (struct, planet, fleet, wallet…), never `undefined`. Every screen's visible text is linted, every control must have a name, every meter must explain itself, the link state must speak plainly, help and glosses must open and close. | `clarity` |
| **Accessibility & input** | Can a player who cannot see the sky, or use a mouse, still play? | Landmarks and names, the canvas hidden from assistive tech, Tab reaching nav, roster and rites, Enter picking a beast, modal dialogs that close on Escape and give focus back, polite heralds that never stack past three, reduced motion, a tap on the sky picking a beast, and two fingers pinching to zoom (in and out, never picking a beast). | `a11y` |
| **Compatibility: screens & devices** | Does it fit on what players own? | Six viewports from a 1440 desktop to a 390 phone and a landscape phone: no sideways scroll, the primary control on screen, touch targets ≥36px, no clipped text, the roster showing a useful number of rows, and a live resize desktop → phone → desktop. | `responsive` |
| **Resilience & network** | What happens when the world misbehaves? | The ledger down from the start (honest message, "Try again", recovery), a 3 s ledger, 503s on one path, the live feed dropping and returning, bells stalling, a typeless struct, a vanished planet, and a refused rite retold in the realm's words. | `resilience` |
| **Performance & memory** | Does it stay fast and does it leak? | Draw calls, triangles, programs and textures per screen against budgets; frame pacing; six laps of every road under garbage collection watching DOM, canvases, heap and WebGL contexts; a 60 s soak on the Hold with ledger events every 3 s. | `perf` |
| **Regression** | Does the bug that was fixed stay fixed? | The Ghoul Archer has a named permanent check in `hold`, and its root cause has a check in `assets` for every type. Each fixed defect gets a check that would have caught it. | all |

Two pillars a studio also runs are deliberately *not* automated here, and are called out so nobody assumes
they are: **playtesting** (is it fun, is the pacing right) and **certification/compliance** (store rules).
Both need people.

### Severity

Every check declares what its failure means, and the report rolls them up:

| | Meaning | Gate |
|---|---|---|
| **S0** | Blocker: a crash, a black screen, a lost or wrong rite | fails the run |
| **S1** | Broken: a feature does not do what it says | fails the run |
| **S2** | Unclear: the player is misled, stuck, or reads the engine's words | reported |
| **S3** | Polish | reported |

A check can also pass **with findings** (`warn`): the thing works, but the check saw something worth a
designer's eye (a small touch target, focus lost after a dialog). Findings never fail a run; they are the
backlog.

---

## 2. How it is built

```
qa/
  run.mjs            the runner: ledger + game + Chrome, suites, report, exit code
  lib/
    cdp.mjs          Chrome DevTools driver (launch, pages, eval, input, screenshots, console capture)
    ledger.mjs       the mock ledger: LCD (REST) + live feed (Tendermint WebSocket) + mock coven scribe
    world.mjs        fixture skies: ids, wardens, isles, warbands, every beast in every state
    app.mjs          Vite serving src/ against the mock ledger
    game.mjs         game-aware helpers: open a screen, wait for the sky, read the scene, measure pixels
    png.mjs          a PNG decoder, so "black screen" is measured on the real screenshot
    report.mjs       suites, severities, expect helpers, the JSON and Markdown report
  suites/*.mjs       one file per pillar
  blank.html         a blank page on the game's origin (storage is seeded here before boot)
  three.mjs          three, resolved by Vite, for the asset checks
```

**The mock ledger** (`lib/ledger.mjs`) serves every endpoint the client reads (`/structs/player`,
`planet`, `fleet`, `struct`, `guild`, `reactor`, `substation`, `infusion`, `address`, `grid`,
`struct_type`, the Cosmos `blocks/latest`, `node_info`, `auth`, `bank`, `simulate`, `txs`), strikes a
bell on its WebSocket every second, and can be told to misbehave: `faults.down`, `faults.latencyMs`,
`faults.failPaths`, `faults.wsDown`, `paused`. Tests change the world between reads and strike events with
`ledger.emitTx([...])`, exactly as a node would. Signed rites are accepted (the client simulates, signs
and broadcasts for real), and a test can react on `onBroadcast` to play the chain's part. It also plays a
coven's `guild.json` and the scribe's `/api/auth/signup`, so the oath runs end to end.

**The fixture sky** (`lib/world.mjs`) is deterministic. `standardSky()` makes three covens with
wellsprings and shrines, and these wardens:

| Warden | Why |
|---|---|
| **Testwarden** (the menagerie) | one of every beast and hallow: awake, slumbering, veiled, being summoned, wounded, on guard, and one fallen (must never show) |
| **Grimwald** (the foe) | hallows, a warband at home, wildroot to plunder |
| **Newling** | no isle yet |
| **Hoarder** | 32 bound: a crowded isle |
| an unnamed warden | "Warden 1-N" is the only id the tongue allows |
| **Ashen** | a spent isle |
| **Oddkin** | a beast of a type the catalogue does not know |
| 18 named wardens | the Atlas and the ticker |

**The game** runs under Vite on port 5193 with `VITE_LCD_URL`/`VITE_RPC_WS_URL` pointed at the mock,
GRASS off, the relay off (covens are read directly from the mock), so nothing in a run touches the real
network unless `--net` is passed.

**Chrome** runs headless with ANGLE/SwiftShader so WebGL, shaders, bloom and the composer all run for
real. Every page records console messages, uncaught exceptions and failed requests; `page.errors(ALLOW)`
is the standard "did anything go wrong" check. Screenshots are decoded and measured (`lookAtStage`) so a
black sky is detected the way a player sees it, not inferred.

**Test seams in the game** are tiny and inert in play: `mountScene` puts the scene controller on the
canvas as `canvas.__wyrmCtl`; the Hold and Skirmish scenes expose `where(id)` and `census()`; the dev
hook already set `window.__wyrmStage`. Nothing else in `src/` knows the proving ground exists.

### Writing a check

```js
await t.test('every roster item stands on the isle', 'S0', async (c) => {
  const ids = await page.eval(`[...document.querySelectorAll('.roster-panel .item')].map((b) => b.dataset.key)`);
  const census = await ctl(page, 'k.census()');
  const missing = ids.filter((id) => !census.units.includes(id));
  expect.eq(missing.length, 0, 'roster items missing from the isle', missing);
  c.warn('something worth a look');          // a finding that does not fail the check
  await page.screenshot(c.evidencePath('isle.png'));   // attached to the report
});
```

`expect.ok / eq / gte / lte / includes / noErrors` throw a `Failure` with details that land in the report.
Suites get `ctx`: `{ browser, app, ledger, sky, report, worldLib, newPage() }`.

---

## 3. The Ghoul Archer, as a case study

**Report:** does not appear on the isle; selecting it from the roster blacks the screen.

**Reproduction:** `#/hold/1-163` on the public ledger (two Ghoul Archers). Console: two
`THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values`. A name tag "Ghoul Archer"
pinned at the top-left corner. After selection, `camera.position` is `[NaN, NaN, NaN]` and stays so.

**Root cause** (`src/world/beasts.js`, the tattered cape): each strip is a plane translated so its top row
sits at `y = 0`, then bent with `z = -pow(-y, 1.4)`. In Float32 the top row is not exactly 0 but a hair
above it, so `-y` is a tiny negative, and a fractional power of a negative number is NaN. Four of the
seven strips had this. One NaN vertex then poisons everything that measures the object: `seat()` puts the
holder at `y = NaN` (invisible, tag at 0,0), and selecting it asks the camera to look at NaN, which
`lerp`s the camera into NaN forever: black screen, no recovery.

**Fixes:**
1. `Math.max(0, -yy0)` in the cape (the cause).
2. `beast()` now passes every body through `sane()`: any mesh with a non-finite coordinate is dropped and
   said once in the console; the rest of the beast still stands (no beast can ever vanish for this again).
3. `seat()` falls back to the ground height when the measured seat is not finite.
4. `Orbit.to()` refuses a non-finite target, distance, elevation or azimuth (no scene can black the screen
   this way again).

**Checks that now stand guard:** `assets` scans every type for NaN at rest and over animation;
`hold › every roster item stands on the isle` and `hold › selecting every item in turn keeps the camera
finite and the sky lit` run on the menagerie; `bestiary` and `skirmish` do the same on their scenes.

---

## 4. What the first runs found

Each row is a defect the proving ground found on the 2026-10-10 runs, with the check that now guards it.

| Sev | Defect | Fix | Guarded by |
|---|---|---|---|
| S0 | **Ghoul Archer invisible; selecting it blacks the screen.** NaN in its cape geometry poisoned its seat and the camera (§3). | Cape clamp; `sane()` drops broken parts; `seat()` and `Orbit.to()` refuse NaN. | `assets` (every type), `hold` parity and selection |
| S0 | **A new player on a landscape phone could not start.** At 844×390 the Gate's content is 940 px tall in a screen that did not scroll, so "Swear the oath" sat out of reach. | The Gate scrolls in that layout. | `responsive` phone landscape |
| S1 | **Memory leak on every screen visit** (~15 MB per visit to the Hold, ~11 MB the Skirmish, ~14 MB the Gate; 127 → 301 MB over six laps). three.js leaves each renderer's texture-dispose hook on shared textures (its own lighting table, the cached glows), so every disposed renderer, its programs and its last scene stayed reachable. | `holdTextureHooks()` in `look.js` learns each renderer's hook from a probe texture and takes it back on dispose (Stage and portraits). Heap now flat at 38–39 MB over six laps. | `perf` long session |
| S1 | **Roster shows no beasts on a 1024×700 laptop** (list 27 px tall). | Short screens: realm chips on one sideways row, one notice at a time, a column floor and a scrolling panel layer. Now two rows at 1024×700, five at 1280×800. | `responsive` roster rows |
| S1 | **The roster showed two of fifteen beasts at 1024×768** with Ysolde folded: the Hold reserved her corner twice. | The pill reservation no longer applies on the Hold (the rites bar already clears it); rites tiles tighten on short screens. | `responsive` |
| S1 | **Soulstone could fail to bind on a busy device**: the key store gave up after 4 s while the sky's shaders compiled ("IndexedDB did not open in time"). | Wait 15 s. | `flows` oath |
| S2 | **Ledger marks after nouns leaked**: "warband 9-12 is away", "coven 0-1 refused". | `speak()` drops a bare mark after a thing's name. | `logic` tongue |
| S2 | **Node wrappers leaked into refusals**: "Rpc error: code = Unknown desc = …". | `speak()` strips the wrapper and "failed to execute message; message index: N:". | `logic` tongue, `resilience` refused rite |
| S2 | **Help never named the Skirmish, Bestiary or Leyweave**, so a new warden had no map to three of the places. | Help's round names all seven places. | `clarity` help |
| S2 | **Escape did not close the Summon, Guard, Feed or help dialogs.** | One Escape handler closes the topmost dialog through its own close or "Not now". | `a11y`, `hold` |
| S2 | **Focus stayed behind when the Summon, Guard and Feed dialogs opened, and fell to the page when they closed.** | Focus moves to the first choice and returns to the opener. | `a11y` |
| S2 | **Grimoire jump links were 18 px tall**, under the 24 px touch minimum. | 32 px. | `responsive` |
| S3 | **A rebuilt scene inherited GL state** from the renderer before it on the same canvas, so three's empty 3D textures failed to upload ("texImage3D: FLIP_Y … isn't allowed"). | The unpack state is reset before a new renderer takes a canvas. | `a11y` console checks |

### Findings left for design (reported, not failures)

- On a phone the Hold's rite buttons sit about 2.7 screens down, below the roster and card. A sticky bar would collide with Ysolde's lantern, so it needs a design decision.
- Realm chips, coven chips and the Skirmish's view switch are 34 px tall on touch screens: above the 24 px minimum, below the 44 px comfort size.
- Under software rendering a first frame takes 2–5 s on the Gate, Hold and Skirmish while shaders compile. Real GPUs are far faster, but the number is the trend line to watch.

### Measured, for the trend

| Screen | Draw calls | Triangles | Programs |
|---|---|---|---|
| Gate | 381 | 323 k | 54 |
| Hold (menagerie, 21 bound) | 539 | 325 k | 80 |

The asset census (triangles and meshes per beast) and the draw census for every screen are written to each report's notes.

---

## 5. Running it in CI

`.github/workflows/qa.yml` runs the quick gate (`assets logic smoke hold`) on every push and pull request
and the whole ground with `--net` nightly, uploading `qa/reports/ci` as an artifact. `node qa/run.mjs`
needs Chrome (`QA_CHROME=/path/to/chrome` if it is not in a standard place); GitHub's Ubuntu runners
have it at `/usr/bin/google-chrome`. Under software WebGL a full run takes about 105 minutes, most of it
shader compilation; the quick gate about 20.

---

## 6. The arena: a sky that fights back

The proving ground's ledger accepts rites but never plays them. `qa/arena.mjs` plays the ledger's part
for war, so a raid can be fought end to end on this computer: strikes, dodges (Glamour, Windslip), guards
that strike back and take the blow, stone-skin, the mark's answer, the Thunder Spire, soaring, riding
out (only on an awake Elder Wyrm), a raid broken by a fallen Wyrm, and plunder, refused while the
defender's Wyrm stands. Each rite is told back as the same `EventAttack` / `EventRaid` /
`EventOreTheft` the ledger emits, in the tx result and on the live feed. The order and odds follow
`attack_context.go`; only the dice differ (`Math.random`, not the block hash).

```bash
node qa/arena.mjs                 # http://127.0.0.1:5194/#/skirmish/1-2 · Grimwald strikes back every 15 s
node qa/arena.mjs --calm          # a foe who never strikes
node qa/arena-shots.mjs OUT after # captures of the Skirmish (also: before, devices, fun)
node qa/playtest.mjs "$PWD" 5182 new-default 2   # bots that only do what the screen shows them
```

`qa/playtest.mjs` plays whole raids as a first-time player would: press the big button when it is
ready (`new-default`), or switch on Fight on (`new-fighton`), or, on the screen before the redesign,
pick the first beast and mark (`old-first`) or aim Wyrm at Wyrm (`old-wyrm`). On 2026-10-12 the old
screen won 1 raid in 9 and lost the Wyrm in 8; the new one won 11 of 12 counted (the twelfth was won but
missed by an earlier count) and lost none, and told every blow's result on screen.

Swear in the page's console as the arena's warden (any soulstone maps to them):
`const { wallet } = await import('/src/wallet/wallet.ts'); await wallet.createInstant(); await wallet.resolvePlayers();`

`.claude/launch.json` has `wyrmhold-arena` (5194) and `wyrmhold-arena-calm` (5195). The sky: Aldric
(you) with an Elder Wyrm and one beast in each realm; Grimwald with a Comet Sprite guarding his Wyrm,
a veiled Shade Owl, a Thunder Spire and six sheaves of wildroot. Don't edit `src/` while a QA run is
going: Vite hot-reloads the pages under test, and checks fail that would otherwise pass.
