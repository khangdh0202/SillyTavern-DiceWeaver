# Dice Weaver — User Guide

[🌐 English](USER_GUIDE.md) | [🇻🇳 Tiếng Việt](USER_GUIDE.vi.md) · ← Back to [README](README.md)

The complete manual for the Dice Weaver extension: every feature, every setting, explained step by step.

---

## Table of contents

1. [Core concept: intent vs outcome](#1-core-concept)
2. [Getting started](#2-getting-started)
3. [Roll trigger modes](#3-roll-trigger-modes)
4. [The dice rules](#4-the-dice-rules)
5. [Settings reference](#5-settings-reference)
6. [Per-character rules](#6-per-character-rules)
7. [Forced trigger (roll on keyword)](#7-forced-trigger)
8. [The Roll Hub button & badge](#8-the-roll-hub-button--badge)
9. [The Roll Hub dashboard](#9-the-roll-hub-dashboard)
10. [Manual rolls & the /roll command](#10-manual-rolls--the-roll-command)
11. [Re-rolling](#11-re-rolling)
12. [Where your data lives](#12-where-your-data-lives)
13. [Using Dice Weaver with other extensions](#13-using-dice-weaver-with-other-extensions)
14. [FAQ & troubleshooting](#14-faq--troubleshooting)

---

## 1. Core concept

Dice Weaver splits a dice check into two halves:

| Half | Who does it | What it is |
| --- | --- | --- |
| **Intent** | The AI | One short line: *"character X attempts Y, using stat Z, difficulty DC"* |
| **Outcome** | The extension | The real roll: `d20 + modifier (from stat) vs DC`, crit rules applied |

The AI never sees or invents dice numbers. Cards are injected into the chat as UI; the marker left in the message text is a slim `[dice:#id]` with no outcome data, and roll results are stripped from prompt history. So the AI can *react* to outcomes, the setting "Feed roll results to the AI" (on by default) injects the last few unseen results as a short instruction for the next turn only. Rolls made through the `roll_dice` tool are skipped: the tool result already told the model (a re-roll is fed again). Turn it off and nothing roll-related enters the model's context.

## 2. Getting started

1. Install the extension (see [README](README.md#installation)), reload SillyTavern.
2. Open any chat. A **Dice Weaver** button appears above the input box.
3. Play. When the AI attempts something uncertain, it ends its reply with a roll intent — the card with the real result appears in its place.
4. Optional: open ⚙ **Extensions → Dice Weaver** to set a trigger keyword, change the stat formula, or add per-character rules.

No character sheet, no card edits, no prompt engineering required.

## 3. Roll trigger modes

One setting decides how the AI is asked to trigger rolls:

| Mode | How it works | Use when |
| --- | --- | --- |
| **Auto** (default) | Uses the native function tool `roll_dice` when your model/API supports tool calling; automatically falls back to the tag protocol after the configured number of tool-less replies (**Tool-less replies before switching**, default 3, in *AI integration*) | Almost always |
| **Function Call only** | Only the stealth tool. If the model can't do tool calling, the tag fallback kicks in anyway (with a warning on the Hub badge) | You want clean text, no tags |
| **Tag only** (token saver) | The AI ends its reply with a single `<roll ...>` line; the extension parses and replaces it | Weak/strict models, or you want the smallest possible footprint |

Notes:

- The AI is nudged by a small system directive; it is told to roll *sparingly*, only for meaningful attempts.
- The extension also accepts the shapes models sometimes emit by mistake: the XML tool-call alias `<roll_dice ...>`, self-closing tags, an intent tag whose reply got cut off mid-line — they are parsed or safely salvaged, never shown raw.
- Old messages that still contain a raw tag are healed automatically after a page reload or chat switch.

## 4. The dice rules

A roll is: `natural die roll + modifier + bonus, compared to DC`.

- **Stat → modifier formula** (default `round(({stat}-50)/15)`): `{stat}` is replaced with the stat value the AI declared. Only safe arithmetic is allowed (`+ - * / %`, parentheses, `round/floor/ceil/abs/min/max`) — an invalid formula evaluates to 0, and the settings show a live preview (`stat 30 → −1 · 50 → +0 · 80 → +2`) that turns red when the formula is broken. The formula only runs when a stat was actually given — manual rolls (`/roll`, Quick roll) have **no** stat modifier.
- **Difficulty class (DC)** — default 10; the roll succeeds when `total ≥ DC`. The AI may pass a number or a **named ladder** value — `dc="easy|normal|hard|extreme"` (5/10/15/20 by default, editable in settings).
- **Advantage / disadvantage / penalty dice** — `adv` (roll twice, take the higher), `dis` (the lower), plus penalty variants `advp` / `disp`: roll one extra die on top of double and **sum** the kept ones (a d20 rolls 3, keeps the best — or worst — 2).
- **Crit 20 / crit 1** — natural 20 always succeeds (crit), natural 1 always fails (crit fail). Toggleable. These are **d20 rules**: they apply only when the kept result is a single d20 (plain `1d20`, or `adv`/`dis` of it). A d100 showing 20, a `2d20` sum, a penalty-dice sum or a multi-term formula is just compared to the DC.
- **Formula override** — the AI (or you, via `/roll`) may pass `1d20+3`, `2d6`, `d20-2`, even **multi-term** formulas like `2d6+1d4+3` — every die is shown on the card. A formula with no dice (just `3`) is rejected, not silently turned into a d20.
- **Damage rolls** — `kind="damage"`: no DC, always succeeds (a natural 1 still crit-fails when the rule is on); the card shows a **Damage** label instead of *vs DC*.
- **Where each option works** — penalty dice (`advp`/`disp`) and damage rolls (`kind="damage"`) are available in `<roll>` tags; penalty dice also work in `/roll`, Quick roll and `DiceWeaverAPI.rollFor()`. The `roll_dice` function tool only offers plain checks with `adv`/`dis` — in Function Call mode the AI cannot request either one.
- **Dice math is safe** — randomness comes from `crypto.getRandomValues` with unbiased rejection sampling.

## 5. Settings reference

Open ⚙ **Extensions → Dice Weaver**. Settings are grouped into five collapsible sections — **General** (switch, mode, language), **Roll rules** (formula, DC, ladder, crits, test roll), **Forced roll trigger**, **AI integration** (results feed, FC fallback) and **Per-character rules**. The open/closed state of each section is remembered.

| Setting | Default | What it does |
| --- | --- | --- |
| Enable dice rolls | ON | Master switch; off = no directive, no rolls |
| Roll trigger mode | Auto | `Auto` / `Function Call only` / `Tag only` (section 3) |
| Language | English | UI language: English / Tiếng Việt / `Auto` (follows SillyTavern) |
| Stat → modifier formula | `round(({stat}-50)/15)` | Template for the modifier; `{stat}` placeholder |
| Default DC | 10 | Used when neither the AI nor the roll specifies one |
| DC ladder | 5/10/15/20 | Values for `dc="easy/normal/hard/extreme"` in AI tags and the tool |
| Natural 20 always succeeds | ON | Crit rule (single d20 only) |
| Natural 1 always fails | ON | Crit-fail rule (single d20 only) |
| Test roll | — | Preview a card with the current rules |
| Trigger keyword | (empty) | Your keyword for the forced trigger (section 7) |
| Trigger formula | (empty) | e.g. `1d20+3` — used by the forced roll instead of the stat formula |
| Feed roll results to the AI | ON | (section 13): unseen results are injected as a short instruction for the **next** turn only |
| Switch to tags when the AI ignores the roll tool | ON | Auto mode: after N AI replies in a row without any roll, the tag directive is added as a reminder |
| Tool-less replies before switching | 3 | That N (1–20). Any roll resets the counter; so do a chat switch and the Hub's *Reset counter* |

Empty DC fields mean *"leave as is"* — the value is never silently reset to 1.

## 6. Per-character rules

Inside the settings, the **per-character fieldset** lets you override everything for one character (chosen from your character list):

| Field | Empty means |
| --- | --- |
| Dice for this character | Inherit the master switch (**Off** = this character never rolls) |
| Feed roll results to the AI | Inherit the global feed setting |
| Stat → modifier formula | Inherit the global formula |
| Default DC | Inherit the global DC |
| Trigger keyword | Inherit the global trigger |
| Trigger formula | Inherit the global trigger formula |
| Natural 20 succeeds / Natural 1 fails | Inherit the global crit rules |

Rules are saved **per character card** (keyed by the card's avatar file), so a character keeps its own rules across every chat. Press *Save character rules* to store, *Delete character rules* to remove. Characters that have rules are marked with ● in the list and a *has rules* badge. Empty fields show the inherited global value as a placeholder; the formula field has the same live preview as the global one. Legacy data keyed by character name is read automatically.

The AI can also name a character in its roll intent — that name picks the matching per-character rules and is shown on the card (with the avatar).

## 7. Forced trigger

Want a roll *now*, not "when the AI feels like it"?

1. Set **Trigger keyword** (or a per-character keyword), e.g. `roll`.
2. When one of your messages contains that keyword, the next AI reply is instructed — via a one-shot directive — to end with exactly one roll line **if** the situation in your message happens. Plain keywords match on **word boundaries** (the keyword `roll` does not fire on "scroll"); keywords starting with `/` or `!` only fire at the start of your message or after a sentence.
3. The directive is consumed after one reply (or after the generation ends). In group chats it stays available so every member's reply can roll.
4. **Trigger formula** (optional) replaces the stat-based formula for that forced roll, e.g. `2d6+1`.

Other extensions can also drive a forced roll through the public API (section 13).

## 8. The Roll Hub button & badge

The **Dice Weaver** button lives above the input box (next to the Character State button when that extension is present, otherwise at the front of the send form). On narrow screens (≤ 768 px) it shrinks to the dice icon + badge. The badge shows how many rolls the current chat contains:

- **Green border** — enabled and functional.
- **Dimmed** — the extension is switched off.
- **Yellow border** — mode is *Function Call only* but your model/API doesn't support tool calling (the tag fallback is active).
- **Neutral (no colored border)** — *Auto* mode on a model/API without tool calling. Nothing is wrong: Auto simply uses tags, and tag rolls work normally.

Click (or Enter/Space) opens the dashboard. The button re-anchors itself on chat switches and page reloads.

## 9. The Roll Hub dashboard

Press the button to open the **Roll Hub** popup:

- **Header** — what the current mode does right now (plus the active trigger keyword) and status chips: enabled/disabled, current mode, whether function calling is supported — plus a warning chip with a **Reset counter** button when the AI has skipped rolls long enough that the tag fallback is active.
- **Stats** — rolls in this chat, **success rate** (checks only — damage rolls have no DC), **Nat 20** and **Nat 1** counts, and the **average d20** (single-d20 rolls).
- **Quick roll** — character (suggestions from this chat; empty = the active character), optional action text, formula, DC (empty = the character's default), advantage. **Enter** rolls. An unreadable formula is flagged inline and nothing is rolled. Same result as `/roll` (section 10).
- **Roll history** — search plus character / outcome / source filters and a live `filtered / total` count. Rows are newest first: character, outcome (color-coded border), total vs DC, source, message number, formula, advantage, relative time. **Click a row to jump to its message** (the popup closes and the message flashes; if the message is not loaded yet, a toast tells you to use *Show more messages*). Each row has **undo re-roll** (when a previous result exists), **re-roll** and **delete**. Long histories show 150 rows at a time with a *+N* button.
- **Footer** — *Rescan* (redraw every card, DOM-only), *Export JSON*, and — kept apart on the right — *Delete all rolls* (confirm prompt; message text is kept).
- The dashboard updates itself while it is open (new rolls, swipes, edits) **without** losing what you typed, the open filter, or the list scroll position.
- Close with the button / ✕ / ESC — all three always work.

## 10. Manual rolls & the /roll command

You can roll without the AI:

```
/roll
/roll 1d20+3 dc=12 adv=adv name="Alice"
/rollhub
```

- `formula` (optional) — `1d20+3`, `2d6`, `d20-2`, multi-term `2d6+1d4+3`… default is a plain d20.
- `dc=N` — difficulty (a number, or leave empty for the character's/global default DC; the AI's tags may also use `easy/normal/hard/extreme`).
- `adv=adv|dis|advp|disp` — advantage / disadvantage / penalty variants.
- `name="Char"` — character name; picks that character's rules and labels the card.

The result attaches to the **last AI message** as a card; if the chat has no AI message yet, a small system line with the roll is added instead. Manual rolls use **no stat modifier** (there is no stat) — `/roll 1d20+5` is exactly d20 + 5. The command prints a toast and returns nothing (nothing lands in your input box). `/rollhub` opens the Roll Hub dashboard (section 9).

## 11. Re-rolling

Every card has a **re-roll** button, and every row in the Roll Hub history has **re-roll / undo / delete** buttons. Re-rolling:

- Re-rolls only the dice — the original modifier, bonus, DC, advantage and formula are kept (editing the stat formula later does not change old rolls).
- Updates the card in place — the message text is not rewritten (markers carry only the roll id).
- Saves the previous result as a one-level snapshot: an **undo** button appears on the card itself and in the Hub row.

### Reading a card

The card shows the character (with avatar — including your persona), the action, the stat → modifier and note, and a large **total** with the outcome label (*Success*, *Fail*, *Nat 20 · Critical*, *Nat 1 · Fumble*, or *Damage*). The strip underneath lists **every die rolled** — dice dropped by advantage/disadvantage are struck through, a natural 20 / 1 is highlighted — then modifiers, `= total`, `vs DC`, an **ADV/DIS** tag and the formula.

## 12. Where your data lives

- **Roll results** — inside the current chat's save data: `extra.diceRolls` (the payload, plus a per-swipe copy in `extra.diceRollsBySwipe`).
- **Markers** — the message text keeps a slim `[dice:#id]` marker where the card is rendered; it is the render hook and carries **no** outcome data (results live only in the payload, so they never leak into the AI's history). Markers without a matching payload are simply hidden.
- **Settings & per-character rules** — your SillyTavern extension settings.
- Nothing is written to the character card, and nothing leaves your machine.

## 13. Using Dice Weaver with other extensions

Dice Weaver works standalone, but exposes a small **API** for bridges:

```
globalThis.DiceWeaverAPI
  apiVersion: 3, toolName: 'roll_dice'
  // v2 (frozen — used by existing bridges)
  isEnabled(), getMode()
  getTrigger(), getTriggerFormula()      // active character's trigger settings
  hasForcedRoll(), getForcedDirective()  // pending forced-roll directive
  stripMarkers(text)                     // remove [dice:#…] markers from history text
  // v3 (additive) — all returned data is deep-copied, safe to keep
  getRolls()                             // [{ messageId, roll }] snapshot of this chat
  rollFor({ character, action, dc, formula, adv, note, stat_label, stat_value })
                                         // roll now via the normal pipeline
  deleteRoll(id)                         // remove a roll (card + payload)
  getUnseenResults(), clearUnseenResults()  // roll results not yet fed to the AI
```

`rollFor()` options: `character` picks the per-character rules (returns `null` when dice are off for that character, otherwise the new roll payload); `dc` is a number or a ladder word; `adv` is `adv|dis|advp|disp`; `note` and `stat_label` (e.g. `"STR 3"`) are shown on the card; `stat_value` runs the stat → modifier formula — leave it out for a roll with no stat modifier. An empty `action` shows as *Roll*. Damage rolls are not available through `rollFor()`.

Dice Weaver never imports or depends on other extensions. In [Storyline](https://github.com/khangdh0202/SillyTavern-Storyline) chats the Storyteller replaces the whole prompt, so its `dice_roller` function uses this API to deliver forced-roll instructions and keep markers out of the AI's history — the intended integration path.

### Optional: feed results to the AI

By default the AI never learns roll outcomes. Turn on **Feed roll results to the AI** (global, or per character) and the last few unseen results are injected as a short instruction — *"these are decided, narrate the consequence; never mention dice numbers"* — for the **next turn only**, then marked as seen. Nothing is written into messages.

**Continue:** when you press *Continue* on a reply that contains rolls, the outcomes of the rolls **in that reply** are injected for the continuation (even after a reload or a re-roll), so the AI picks up from the real result instead of guessing. A re-rolled or undone roll is treated as unseen again.

## 14. FAQ & troubleshooting

**The AI never rolls.**
Check the extension is enabled and the mode fits your model (Auto covers most). Weak models may simply forget — in Auto mode the directive switches to the more insistent tag protocol by itself after the configured number of tool-less replies (**Tool-less replies before switching**, default 3; a warning chip with a *Reset counter* appears in the Roll Hub).

**I see raw text like `<roll_dice character="…" />` in an old message.**
Old build or a message parsed before a fix — reload the page (F5). The self-heal sweep parses leftover tags in old AI messages automatically (since v0.4.8).

**A card shows raw marker text like `[dice:#ab12cd34 …]`.**
That means the payload is missing (e.g. the message was copied from another chat). Markers without payloads are hidden on the next sweep; *Rescan* in the Hub forces it now.

**My swipe lost a roll card.**
Since v0.4.1 every swipe keeps its own rolls. If you swipe to a *brand-new* swipe position, there are legitimately no rolls there yet — go back and they return.

**The DC on a card is wrong.**
Check the per-character rules (section 6) — a character override beats the global default. Empty fields inherit.

**The Hub badge is yellow.**
Mode is *Function Call only* but your current model/API can't do function calling. Switch to Auto or Tag only — rolls keep working through tags either way.

**Can the AI cheat?**
No. Outcomes come only from the extension's RNG; hallucinated outcome tags are stripped, malformed intents are repaired or rejected, and message markers carry no numbers. The only channel to the model is the results feed (section 13, on by default), which instructs it to narrate consequences — never to quote dice.

---

*Dice Weaver — intent in, dice out.*
