# Changelog — Dice Weaver

All notable changes to this project. Versions match `manifest.json`.

## [Unreleased]

Fixes on top of 0.6.0 (`manifest.json` still says 0.6.0).

### Fixed
- **`roll_dice` tool rejected by strict providers**: the tool schema carried an invalid
  `$schema` meta-schema URI, and some providers refused the whole request. The key is gone.
- **Bogus "the reply was cut off" rolls and duplicate rolls**: a message that is still
  being streamed is never tag-parsed (an unfinished `<roll ...` looked like a cut-off tag,
  and a second parse duplicated the roll). It is parsed once the text is final.
- **Phantom rolls in the Hub**: at the end of a generation, payloads created in that turn
  whose marker the finished reply no longer contains are dropped (older rolls are never
  touched — a Continue that loses markers cannot delete them).
- **Re-roll reverted by a swipe after a reload**: re-roll/undo now update the per-swipe
  copy too, and swiping back prefers the newer result.
- A blocked re-roll (extension or character switched off) shows why instead of doing nothing.
- **Continue after a roll card made the new text disappear**: when the last message was a
  roll card, SillyTavern's Continue appended the new text to that card, which only shows the
  card. The text now moves into its own reply after the card (an echoed copy of your
  message is dropped). A roll card that already holds hidden text is repaired when the chat
  opens.
- **Results feed + Continue**: Continue feeds the outcomes of the rolls in the reply being
  continued (also after a reload); re-rolled/undone rolls are fed again.
- **Salvaged (cut-off) tags** use their `note` as the action text instead of an English
  placeholder.
- The forced-roll directive (also returned by `DiceWeaverAPI.getForcedDirective()`) is now
  English like every other text sent to the model.
- `/roll` lists `advp`/`disp` in its `adv=` options; its toast, the Hub mode chip and the
  default card texts (*Manual roll*, *Roll*) follow the UI language.

### Docs
- Penalty dice and damage rolls are tag-only for the AI (the `roll_dice` tool offers plain
  `adv`/`dis` checks); `rollFor()` options documented; the neutral Hub badge state
  documented; install troubleshooting no longer asks for a specific folder name; Storyline
  link fixed.

## [0.6.0] — 2026-10

Bug-fix + UX overhaul release.

### Fixed
- **Streamed Function-Call rolls no longer become a separate "Dice" system message.** With
  streaming, SillyTavern finalizes a reply that carries a stealth tool call WITHOUT firing
  `CHARACTER_MESSAGE_RENDERED`; the roll now attaches to the reply of the current turn
  (turn anchor recorded at `GENERATION_STARTED`), and that reply is tag-parsed and counted.
- **Manual rolls had a hidden −3**: `/roll` and the Hub ran the stat formula with stat 0
  (`round((0-50)/15) = -3`). Rolls without a stat now have no stat modifier.
- **False crits on non-d20 dice**: nat-20/nat-1 rules now apply only to a single kept d20
  (`1d20`, adv/dis). A d100 showing 20, a `2d20` sum or a penalty-dice sum is not a crit.
- **Re-roll keeps the original modifier** instead of re-evaluating the (maybe edited) formula.
- **Tag rolls honor the custom DC ladder** (global and per-character) — `dc="hard"` was
  always 15.
- **Tag rolls carry `ts`/`payload_version`** (they skipped the payload factory) — the Hub
  shows their time.
- **Auto-mode FC→tag fallback could never trigger**: the miss counter was reset on every
  user message. It now counts consecutive roll-less AI replies; its two settings finally
  have UI.
- **Results feed**: `regenerate` and `quiet` (background generations by other extensions)
  no longer consume unseen results before the real reply gets them.
- Dry-run / quiet `GENERATION_STARTED` no longer reset the turn state.
- Roll cards no longer overflow horizontally on phones.

### Changed — UI/UX
- **Roll card redesign**: outcome label (*Success / Fail / Nat 20 · Critical / Nat 1 ·
  Fumble / Damage*), a dice strip with every die (dropped adv/dis dice struck through,
  nat 20/1 highlighted), ADV/DIS tag, DC, formula, **undo on the card**, persona avatar for
  the user, initials instead of `?`, theme-aware colors, localized card text.
- **Roll Hub overhaul**: Quick roll at the top (Enter to roll, inline formula validation,
  character suggestions, optional action text); stats are now success rate / Nat 20 /
  Nat 1 / average d20; **click a row to jump to its message**; paged list (150 rows);
  destructive *Delete all* separated from Rescan/Export; the dashboard refreshes by region
  and never loses typed text, filters or scroll position.
- **Settings drawer** grouped into General · Roll rules · Forced roll trigger · AI
  integration · Per-character rules (open state remembered); live formula preview with
  error state; FC-fallback toggle + threshold; per-character rule markers and inherited
  placeholders.
- The send-form button collapses to icon + badge on narrow screens.
- UI language now defaults to **English** for new installs (Tiếng Việt and *Auto* = follow SillyTavern stay selectable).
- README install URL fixed to the real repository (`khangdh0202/SillyTavern-DiceWeaver`); manifest `homePage` set.

## [0.5.0] — 2026-10

Major review-fix release: 9 P0 behavior bugs, P1 logic fixes, two new opt-in features,
UI/UX overhaul, i18n, perf pass and a real DOM test suite.

### Fixed (P0 — wrong behavior)
- **Orphan-marker churn**: a marker whose payload was gone (edited away) re-rendered its
  message block on EVERY event/sweep. Now gated by a per-message text-state key —
  re-rendered at most once, self-invalidating when text or payloads change.
- **Partial renders heal**: DOM cards fewer than renderable payloads → one forced rebuild.
- **FC rolls gluing to the wrong message**: tool-call rolls now attach ONLY to the current
  turn's message (`currentTurnMessageId`, set on `CHARACTER_MESSAGE_RENDERED`); anything
  else parks in `pendingRolls` and flushes on `GENERATION_ENDED` (order: flush BEFORE
  clearing the turn id).
- **`/roll` no longer drops its marker into the slash pipe** — returns `''` + toast.
- **Hub search no longer loses focus** when events re-render the popup mid-keystroke
  (only stats + list refresh while a filter control has focus).
- **Send-form button anchoring** reports real placement (no more 40×250 ms retries when
  the optional anchor extension is absent).
- **Editing a message reconciles orphan payloads**: markers deleted from the text drop
  their payloads (and the current swipe's store) — no phantom Hub rows.
- **Slim markers `[dice:#id]`**: outcome/total/DC no longer live in the message text, so
  roll results can never leak into the model's prompt history. Legacy verbose markers
  still parse. Re-roll no longer rewrites message text.
- **`getSettings()` identity**: the settings object is mutated in place (held references
  stay valid); `characters` is never aliased to the shared default object.

### Fixed (P1 — logic)
- `fcMisses` counts only genuine misses (mode=auto, tools supported, FC directive actually
  active, generation type `normal`); resets on `USER_MESSAGE_RENDERED`; configurable
  `fc_miss_threshold` (default 3) + `auto_fallback_to_tags` toggle; Hub shows a
  "tag fallback active" chip with a counter reset button.
- Trigger phrases match on word boundaries (no more "scroll" matching "roll"); `/`- or
  `!`-prefixed triggers match at message/sentence start.
- Re-roll is blocked for disabled characters and saves a one-level `prev` snapshot (undo).
- Advantage/disadvantage display now shows the extra dice: `⟨7, 17⟩ → 17`.
- Group chats resolve the active character from the last speaker (`mes.name`).
- `computeOutcome` with no DC (damage) always succeeds except natural-1 crit-fail;
  the meaningless `total >= 0` branch is gone.
- DC clamps to 0..99 everywhere (`normalizeDc` + all UIs).
- Markers inside `<pre>/<code>` are never consumed.
- `MESSAGE_DELETED` bumps the rolls index and refreshes the Hub badge.
- **Per-character kill switch** (tri-state inherit/on/off) gating directives, tool,
  re-roll and the public API.

### Added
- **Roll results → AI (opt-in, OFF by default)**: up to 3 unseen outcomes injected as a
  short SYSTEM prompt line for the next generation ("narrate the consequence, never cite
  numbers"); seen-tracking in `chat_metadata.diceweaverSeen` (pruned at 200); per-char
  override; dry-run/continue/swipe/impersonate never consume results.
- **Dice features**: named **DC ladder** (`dc="easy|normal|hard|extreme"`, configurable),
  **multi-term formulas** (`2d6+1d4+3`), **`kind="damage"`** rolls (no DC, nat-1 fumble
  only), **penalty dice** (`adv="advp"`/`"disp"` — roll 3 keep 2).
- **Hub CRUD**: delete a single roll, "delete all" with confirm, JSON export, undo re-roll;
  outcome + source filters; relative timestamps.
- **i18n**: full EN/VI UI (`lang: auto|en|vi`, auto follows SillyTavern locale).
- **`DiceWeaverAPI` v3** (additive): `getRolls`, `rollFor`, `deleteRoll`,
  `getUnseenResults`, `clearUnseenResults`. v2 unchanged.
- **`/rollhub`** slash command opens the dashboard.

### Changed
- **Theme-aware CSS**: cards/hub read `--SmartTheme*` vars via a `--dw-*` palette; the
  `body.light-theme` overrides are gone (every theme adapts).
- **a11y**: card re-roll is a real `<button>` (aria-label), search inputs labelled, badge
  `aria-live`, reduced-motion support (CSS + `animateNumber` with rAF cancel).
- **Module split (DI)**: `dice.js`, `settings-core.js`, `strings.js`, `payloads.js`,
  `render.js`, `rolls.js`, `results-feed.js`, `hub.js`, `settings-ui.js` around a thin
  `index.js` — node-testable without SillyTavern.
- **Perf**: cheap non-global marker gate regex, one regex instance per message walk,
  Hub collect cache (chatId + rolls version), avatar URL cache, retuned sweep delays
  (700/2200, 900, 250 ms).
- **Tests**: a DOM-level test suite (render, payloads, swipe, results feed, settings,
  markers); CI syntax-checks every module.

### Fixed (review round 2 — subagent cross-review)
- **MAJOR**: numeric-only formulas (`3`, `-5`) are rejected again instead of silently
  rolling an unintended `d20+bonus`.
- **MAJOR**: swipe materialization bumps the Hub rolls-version — the dashboard/badge no
  longer serve the previous swipe's rolls from cache.
- **MAJOR**: `DiceWeaverAPI.getRolls()` / `getUnseenResults()` return deep copies —
  consumers can no longer mutate persisted payloads / undo snapshots through nested
  `rolls`/`prev` references.
- **MAJOR**: `healPartialRender` counts distinct ids from the RENDERED field only —
  messages with a mirrored `display_text` no longer trigger endless heal rebuilds.
- **MAJOR**: a tool-only generation can no longer glue parked rolls onto the PREVIOUS
  turn's AI message — the turn id resets on `GENERATION_STARTED`, so they surface as a
  system roll message instead.
- **MINOR**: Hub manual roll with a blank DC inherits the character default (`Number('')`
  no longer becomes DC 0); typed `0` remains valid.
- **MINOR (hardening)**: `createRollPayload` re-asserts `ts`/`payload_version` after the
  result spread; settings inputs use full `escapeHtml` in HTML attributes.
- **MAJOR (hotfix, user-reported)**: `createRollPayload` was imported from the wrong
  module (`dice.js`), which broke the whole extension on load — a new import-graph test
  now really imports every local module and fails on any broken `from './x.js'` wiring
  (class of bug invisible to `node --check`).
- **DOCS**: USER_GUIDE (EN/VI) rewritten for every 0.5.0 feature (Hub CRUD/filters, `/rollhub`, DC ladder, penalty dice,
  damage rolls, multi-term formulas, results feed, i18n, per-char switches, API v3).

## [0.4.8] — 2026-09

- **Tag aliases**: the parser now accepts the tool-call XML shapes models emit as text —
  `<roll_dice ...>...</roll_dice>`, self-closing `<roll_dice ... />`, `<roll ... />`, and an
  intent tag whose reply was cut off mid-line (salvaged at the end of the reply, ≤400 chars,
  must carry `char|character|action=`). Stray debris (`</roll_dice>`, truncated `</roll_`
  stubs) is cleaned.
- `stat_label` is accepted as the `stat` alias (also as the `stat_value` fallback).
- **Tag heal**: the reload/chat-switch sweep now re-parses leftover raw tags in old AI
  messages (idempotent; failed parses are left untouched).

## [0.4.7] — 2026-09

- **Stale-DOM rebuild gate** (`domHasRollUi`): `updateMessageBlock` runs only when the DOM
  shows neither marker text nor an injected card — fixes the first render being silently
  skipped after a tag→marker conversion, without reintroducing flicker.

## [0.4.6] — 2026-09

- **DC normalization** (`normalizeDc`) at every payload boundary — fractional/negative DC
  produced markers that could never parse back.
- Swiping to a swipe with no stored rolls now **clears** `extra.diceRolls` (stale payloads
  caused phantom Hub entries and a false "rolled" signal).
- Empty DC inputs (global + per-character) mean *"leave as is"* — previously `Number('')`
  clamped the DC down to 1.

## [0.4.5] / [0.4.4] — 2026-09

- **One marker per roll**: the per-message marker guard dropped the marker of every second+
  roll in the same message (payload stored, card unrenderable). Dedupe by roll `id` is
  sufficient and kept.

## [0.4.3] — 2026-09

- **`DiceWeaverAPI` v2** (frozen): `getTrigger`, `getTriggerFormula`, `hasForcedRoll`,
  `getForcedDirective`, `stripMarkers` — the public bridge surface (Storyline `dice_roller`
  consumer).
- Sweep hook for `MORE_MESSAGES_LOADED` — lazy "Show more messages" history renders rolls
  correctly.

## [0.4.2] — 2026-09

- **Roll Hub UI** (add-only): send-form button with live roll-count badge (ready/off/warn
  states) + dashboard popup — stats, mode notes, search & character filter, test-roll
  preview, re-scan, full roll history with per-row re-roll, manual roll form.

## [0.4.1] — 2026-09

- **Per-swipe roll storage** (`extra.diceRollsBySwipe`): roll cards survive swipe
  round-trips.
- Short tag-fallback directive after 2 tool-less replies; `fc_only` without tool-calling
  support falls back to the tag protocol instead of dead-ending.

## [0.4.0] — 2026-09

- Hardening pass: orphan/spoofed markers hidden, payloads consumed exactly once.
- Per-character settings keyed by avatar filename (with migration); char dropdown refresh.
- Auto-mode fallback to the tag directive after 2 tool-less replies (`fcMisses`).
- Local regex instances (no shared `lastIndex` state); `Function()` replaced by a
  recursive-descent safe arithmetic evaluator.
- Group-chat forced rolls persist for the whole turn; ⟳ re-roll button on cards;
  `/roll` slash command.

## [0.3.x and earlier] — 2026-09

- Initial prototype line: tag parsing, stealth `roll_dice` tool, result cards.
