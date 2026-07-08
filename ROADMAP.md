# Ren'Py Analytics — Roadmap

Where the extension goes after 0.4. Grounded in community research (Lemma Soft threads, VNDev Wiki, r/RenPy workflows) — see "Demand evidence" under each milestone. [SPEC.md](SPEC.md) remains the architectural reference; this file tracks *what* ships next and *why*.

## Shipped (M1–M4, v0.1–0.4)

- Structural folding (labels, menus, screens, init/python) + fold-all commands
- Save-file safety diagnostics (define-mutable, missing-default, init-variable-changed, …)
- Project analysis: label flow graph, inaccessible labels, dead ends, per-file/per-character stats, speaker consistency, report export
- Current File pane (writing/narrative stats, scenes, connections, click-to-jump)
- Choice-consequence CodeLens
- Story flow graph webview (project + current-file scope) with DOT export
- Playtime estimate, generated file footers, game-folder scoping

## M5 — Warp-to-cursor playtest (v0.5)

Launch the game directly at the scene under the cursor: run the Ren'Py SDK with `--warp file:line`, using the existing `renpy-analytics.sdkPath` setting plus auto-detection of common SDK install locations. Command + editor context-menu entry: **Ren'Py: Playtest From Here**.

- Optional companion setting for an `after_warp` label so devs can seed variables before the warped scene runs.
- Stretch: a "Playtest This Choice" CodeLens entry that warps to the menu line.

**Demand evidence:** the single most recurring testing complaint — devs resort to the Shift+O console, hand-built dev menus, or raw `--warp` invocations to avoid replaying from `start`.

## M6 — Flag & variable explorer (v0.6)

Replace the flag-tracking spreadsheets VN devs keep by hand. A new **Variables** view (activity bar) that indexes every story variable:

- Where it's `default`ed/`define`d, every write (with the menu choice that triggers it, reusing the CodeLens consequence extractor), and every read/gate (`if`, choice conditions, screen `showif`).
- Click-through to each site; orphan detection (written but never read, read but never written) — this subsumes SPEC §3.6 variable-lifecycle diagnostics.
- Flow-graph enhancement: edges gated by a condition get the condition as an edge label; choice nodes that set flags show them.

**Demand evidence:** devs maintain Google Sheets mapping choices → flags → gated scenes; dependency-graph planning is standard practice the tooling doesn't support.

## M7 — Prose pipeline: doc → rpy, dialogue out for proofreading (v0.7)

The draft-in-Docs → port-to-Ren'Py round trip is the ecosystem's biggest unsolved gap. **Design constraint learned from the fountain-flow experiment (see below): no bidirectional round-trip.** The `.rpy` file is the single source of truth; prose flows in once, and dialogue text flows out (and back) only as *text*, keyed to stable anchors — structure never round-trips.

1. **Paste as Ren'Py dialogue** — convert clipboard prose on paste: screenplay format (`NAME` / dialogue blocks), `Name: line` chat format, and a Fountain-flavored dialect (adapted from the fountain-flow `.fflow` spec: `+ [Label] choice`, `-> #target`, `! SHOW:`, `~ var += 1`) into proper `label`/`menu`/dialogue statements. Character-name → variable mapping learned from existing `Character(...)` definitions, with a QuickPick for unknowns.
2. **Export dialogue for proofreading** — Markdown/docx of dialogue-only prose (code stripped), each paragraph carrying a hidden `file:line` anchor.
3. **Re-import proofread text** — diff the returned document's *dialogue text only* against the anchors and apply as edits. Because only string content syncs — never structure — the fidelity problems that sank fountain-flow can't occur.

**Demand evidence:** writers draft in Docs/Scrivener for spellcheck/grammar/comments and hand-port to script; launcher's "dialogue text only" export + Grammarly round-trip is a documented common workflow; no existing tool converts screenplay formats to Ren'Py.

## M8 — Writing progress tracking (v0.8)

Session and daily word-count deltas per project (computed from the existing metrics index, persisted in workspace state), an optional word-count goal with a status-bar progress indicator, and a history section in the Current File / Project views. Export history as CSV/JSON.

**Demand evidence:** word-count threads are perennial on Lemma Soft; uses include progress tracking, VA cost estimation (per-character line counts — we already have these), and playtime estimates.

## Backlog (ordered, post-0.8)

- **Route-length per ending** — min/median/max words from `start` to each ending (upgrades the playtime estimate; SPEC §3.4).
- **Route highlighting in the flow graph** — click an ending to light up every path that reaches it; Twine-style visual parity.
- **Unused asset report** (SPEC §3.5).
- **Dialogue-only spellcheck scope** — cSpell integration on dialogue strings (SPEC §3.10); partially subsumed by M7's export.
- **Label CodeLens** — incoming jump/call counts (SPEC §3.9).
- **Translation coverage** (SPEC §3.8).

## Lessons from fountain-flow (prior art post-mortem)

[fountain-flow](https://github.com/mikezilla14/fountain-flow) was a Python experiment at exactly M7's problem: a Fountain-superset (`.fflow`) transpiling to/from Ren'Py and Twee through a shared AST. Assessment of what carries over:

**Salvage:**
- **The `.fflow` syntax design** (`docs/SPECIFICATION.md`) — the best artifact of the project. Writer-friendly, degrades gracefully in standard Fountain editors, and its choice/jump/state/asset notation (`+ [Label]`, `-> #target`, `~ var += 1`, `! BG:`) becomes M7's paste-import dialect.
- **The AST node taxonomy** (dialogue/action/choice/jump/logic/asset/state) — maps cleanly onto our existing `FileModel`; validates the parser design we already have.
- **The failure analysis** (`fidelity_summary.md`) — round-trip errors clustered into (a) formatting variance the AST can't preserve (`$`-prefix conventions), (b) constructs one format simply lacks (decision prompts in Twee), and (c) structural drift from inline jumps. All three are *inherent* to structure round-tripping, not implementation bugs.

**Leave behind:**
- The Ren'Py reverse parser — line-regex based, no indentation model, no `.local` labels, no `call`, no menu conditions. Our TypeScript parser is already far ahead; nothing to gain.
- The Ren'Py emitter — loses parentheticals, conflates SFX with music, no Character definitions. M7's emitter will be written fresh against our parser's model.
- The bidirectional-transpiler architecture itself — the post-mortem's core lesson. Structure round-trips lose information whenever formats disagree on expressiveness; text-only sync against a structural source of truth does not.
