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

## M5 — Warp-to-cursor playtest (v0.5) — SHIPPED

**Ren'Py: Playtest From Here** (command palette + editor context menu): launches the SDK with `<sdk>/renpy.exe <projectdir> run --warp game/…/file.rpy:line` from the cursor position. SDK resolved from `renpy-analytics.sdkPath`, with auto-detection of `renpy-*-sdk` installs (newest first) and a browse fallback; the choice is persisted. `after_warp` seeding is documented in the README (game-side label, nothing to configure).

- Remaining stretch: a "Playtest This Choice" CodeLens entry that warps to the menu line.

**Demand evidence:** the single most recurring testing complaint — devs resort to the Shift+O console, hand-built dev menus, or raw `--warp` invocations to avoid replaying from `start`.

## M6 — Flag & variable explorer (v0.6) — SHIPPED

**Variables** view (activity bar): every story variable with declaration, writes (each annotated with its enclosing label and triggering menu choice), and reads — condition reads marked as gates. Orphan groups at the top: *Gated but never set* (flag read in conditions, never assigned) and *Never read*. Engine namespaces and Character/image defines excluded; attribute writes credited to the declared base object; `persistent.*` tracked. Subsumes SPEC §3.6 variable-lifecycle diagnostics.

Flow graph gained condition labels on edges leaving `if`/`elif`/`while` blocks (webview + DOT) and consequence summaries on choice-node hover.

**Demand evidence:** devs maintain Google Sheets mapping choices → flags → gated scenes; dependency-graph planning is standard practice the tooling doesn't support.

## M7 — Prose pipeline: doc → rpy, dialogue out for proofreading (v0.7) — SHIPPED

Design constraint from the fountain-flow post-mortem held: **no bidirectional round-trip** — `.rpy` is the source of truth, prose flows in once, dialogue text flows out and back keyed to `<!-- file:line -->` anchors.

1. **Ren'Py: Paste as Ren'Py Dialogue** — clipboard conversion at the cursor: screenplay cues (incl. `(V.O.)` + parentheticals), `Name: line` chat format, narration paragraphs, and the Fountain-flavored `.fflow` dialect (`# SECTION`, `INT.` headings, `? prompt`, `+ [Label] body`, `-> #target`, `~ expr`, `! BG:/SHOW:/HIDE:/MUSIC:/SFX:`). Speaker mapping from `Character(...)` defines with QuickPick resolution for unknowns (map / string speaker / new slug + TODO define).
2. **Ren'Py: Export Dialogue for Proofreading** — anchored Markdown grouped by file and label (docx deferred; the Markdown opens in Word/Docs).
3. **Ren'Py: Apply Proofread Dialogue** — diffs edited paragraph text against anchors, replaces only the dialogue string literal on each line, skips-and-reports lines whose code changed since export.

**Demand evidence:** writers draft in Docs/Scrivener for spellcheck/grammar/comments and hand-port to script; launcher's "dialogue text only" export + Grammarly round-trip is a documented common workflow; no existing tool converts screenplay formats to Ren'Py.

## M8 — Writing progress tracking (v0.8) — SHIPPED

Daily word-count snapshots persisted in workspace state; status-bar counter with today's delta (and `written/goal` readout when `renpy-analytics.dailyWordGoal` is set); Writing Progress section in the Project Analysis view with today/session/last-14-days deltas; CSV/JSON history export via **Ren'Py: Export Writing Progress History**.

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
