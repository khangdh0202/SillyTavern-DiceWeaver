<div align="center">

# Dice Weaver — AI-Triggered Dice Rolls for SillyTavern

**The AI calls the action. The dice decide the outcome. You see it all.**

[🌐 English](README.md) | [🇻🇳 Tiếng Việt](README.vi.md) · [📖 Full Documentation (EN)](USER_GUIDE.md) · [📖 Tài liệu đầy đủ (VI)](USER_GUIDE.vi.md)

</div>

---

## What is this?

**Dice Weaver** lets your AI characters attempt risky actions and resolve them with real d20-style dice — rolled by the extension, never by the model. The AI narrates the attempt and declares its intent; the extension rolls a d20 (with your stats, difficulty and crit rules), shows the result as a compact game-style card in the chat, and keeps every roll browsable in a dashboard.

You play the story. The extension plays fair.

## Why you want it

| Without | With Dice Weaver |
| --- | --- |
| The AI narrates "you succeed" to whatever its heart desires | Uncertain outcomes are decided by real dice — `crypto.getRandomValues`, no bias |
| Success rates live in the model's imagination | Difficulty classes, stat-based modifiers, crit 20/1 rules — all configurable |
| Chat history forgets every check | Every roll persists with its inputs and can be re-rolled from the dashboard |
| "Roll a dice for me" breaks the story flow | The AI ends its turn with one silent intent line; the card appears in its place |

## What it does

- **Two trigger paths** — the AI either ends its reply with a `<roll>` intent tag, or calls a stealth `roll_dice` function tool when your model supports tool calling. Auto mode picks the right one and falls back gracefully.
- **Real dice, real rules** — stat → modifier formula (`round(({stat}-50)/15)` by default), difficulty class (raw numbers or a named `easy/normal/hard/extreme` ladder), advantage/disadvantage plus penalty dice (`advp`/`disp`), natural-20-crit / natural-1-fumble, and multi-term formulas like `1d20+3`, `2d6+1d4` or damage rolls (`kind="damage"`). Penalty dice and damage rolls come from `<roll>` tags (penalty dice also from `/roll`, Quick roll and the API) — the `roll_dice` tool only offers plain `adv`/`dis` checks.
- **Game-style result cards** — avatar, action, a big total with a clear outcome label (*Success / Fail / Nat 20 · Critical / Nat 1 · Fumble / Damage*) and a dice strip showing every die (dice dropped by advantage/disadvantage struck through), modifiers and DC — injected into the message, with re-roll and undo right on the card. Roll results stay out of the model's prompt (slim `[dice:#id]` markers, no numbers in text); optionally (opt-in, off by default) the last few unseen results are fed to the AI as a short instruction so it narrates their consequences.
- **Forced trigger** — type your keyword and the next AI reply *must* roll if the situation calls for it.
- **Roll Hub dashboard** — a button next to the input box with a live badge: a Quick roll form (same as `/roll`), success rate / Nat 20 / Nat 1 / average d20 stats, searchable/filterable roll history where **clicking a roll jumps to its message**, per-roll re-roll / undo / delete, bulk delete and JSON export.
- **Per-character rules** — different formula, DC, triggers and an on/off switch for each character card, keyed to the card itself.
- **Swipe-safe** — every swipe position keeps its own rolls; swiping back and forth never loses or duplicates a card.
- **English & Tiếng Việt UI** — English by default; switch to Tiếng Việt (or *Auto* = follow SillyTavern) in settings.

## Design principles

- **The AI never rolls.** The model only declares *what* is attempted; the extension decides *how well*. Outcome data lives in the message payload and UI only — the model sees at most a short opt-in instruction to acknowledge the results, never dice numbers to invent.
- **Intent, not trust.** Malformed tags, truncated replies and tool-call-shaped text are recovered or rejected with guards; the model can't fake an outcome.
- **Everything is local and per-chat.** Rolls live inside your chat save files. Nothing leaves your machine.
- **Works with every model.** The tag protocol needs nothing special; function calling is used automatically when available.

## Compatibility

- SillyTavern **1.18.0+**
- Any chat completion source; native tool calling is detected automatically (optional but nicer)
- Single chats and group chats; standalone — no other extension required

## Installation

**Requirements:** SillyTavern **1.18.0+**.

**Option 1 — install from SillyTavern (recommended):**

1. Open the **Extensions** panel (puzzle icon) → click **Install extension**.
2. Paste the Git URL: `https://github.com/khangdh0202/SillyTavern-DiceWeaver`
3. Pick **Install just for me** (this user profile) or **Install for all users**.
4. Open any chat — a **Dice Weaver** button appears above the message input box.

**Option 2 — manual:**

Clone or copy the repository into an extensions folder, then reload SillyTavern (F5):

- Per user: `data/<user-handle>/extensions/st-diceweaver`
- All users: `public/scripts/extensions/third-party/st-diceweaver`

**Updating:** Extensions panel → **Manage extensions** → *Update* (or `git pull` inside the folder), then reload (F5). Roll data lives in your chat save files — an update never touches it.

**No configuration needed to start.** Out of the box the AI rolls on uncertain outcomes with a default d20 + stat formula. Open ⚙ Extensions → Dice Weaver to tune modes, formulas, DC and per-character rules (see the guide).

**Troubleshoot:** if the button doesn't appear — check the browser console (F12) for Dice Weaver messages, confirm the extension is listed and enabled in the Extensions panel (**Manage extensions**), and reload with F5. The folder name doesn't matter — installing from the Git URL creates `SillyTavern-DiceWeaver`, a manual copy may be called `st-diceweaver`; both work.

## Documentation

📖 **[USER_GUIDE.md](USER_GUIDE.md)** — the full manual: every setting, the Roll Hub, `/roll`, triggers, step by step.
🇻🇳 **[USER_GUIDE.vi.md](USER_GUIDE.vi.md)** — tài liệu đầy đủ bằng tiếng Việt.

## 🐞 Bug reports & help

Found a bug or have a question? Open an issue on **[GitHub Issues](https://github.com/khangdh0202/SillyTavern-DiceWeaver/issues/new/choose)** and pick *Bug report* or *Question / idea* — the form asks for everything needed.

A good bug report includes:

- your SillyTavern version and Dice Weaver version (Extensions panel → Manage extensions)
- the API / model you use
- steps to reproduce: what you did, what you expected, what happened instead
- errors from the browser console (F12 → Console), if any — copy the red lines
- a screenshot when something looks wrong

Remove private story content and API keys before posting — issues are public.

## ❤️ Support

If Dice Weaver makes your games better, consider supporting the project:

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-ff5e5b)](https://ko-fi.com/kdturtle)

or click the **💜 Sponsor** button at the top of this repository (enabled via `.github/FUNDING.yml`).

## License

Released under the [GNU General Public License v3.0 (GPL-3.0)](LICENSE) — free to use, modify and redistribute; any fork or redistribution must stay open-source under the same license. © 2026 kdturtle.
