# Ren'Py Analytics — VS Code Extension Specification

Working name: **Ren'Py Analytics** (`renpy-analytics`). Final marketplace name TBD.

## 1. Purpose & Positioning

A companion extension for Ren'Py visual novel development focused on **structure, analysis, and writing metrics** — the things a writer/director needs, not the things an IDE language service provides.

It is explicitly designed to run **alongside**, not replace:

- [renpy/vscode-language-renpy](https://github.com/renpy/vscode-language-renpy) — syntax highlighting, completion, go-to-definition, hover, signature help, basic diagnostics.
- [adiffx/renpy-magic](https://github.com/adiffx/renpy-magic) — LSP: workspace symbols, rename, find-references, undefined-label diagnostics, hover previews, a label graph, Ren'Py SDK lint integration.

**Non-goals** (already covered by the above, do not duplicate): syntax highlighting grammar, autocompletion, go-to-definition, hover documentation, rename/references.

Our lane: **story-flow analysis, reachability, writing statistics, and generated file summaries.**

## 2. Core Features (MVP)

### 2.1 Collapsible syntax (folding) for labels and menus

VS Code's default indentation folding works poorly for Ren'Py because top-level `label` blocks all sit at column 0 and a label's body ends only at the *next* top-level statement.

Provide a `FoldingRangeProvider` for `.rpy` / `.rpym` that emits ranges for:

| Construct | Fold span |
|---|---|
| `label name:` | from the label line to the line before the next same-or-lower-indent `label`/`screen`/`init`/`define` block or EOF |
| `menu:` / `menu name:` | the whole menu block (all choices) |
| individual menu choices (`"Choice text":`) | each choice's body |
| `screen`, `init`, `init python`, `python:` blocks | whole block |
| `if / elif / else`, `while`, `for` inside script | standard indent folding |

Details:
- Ranges are computed from the shared parser (§4), not regex-per-request, so they stay consistent with the analysis features.
- Kind: `FoldingRangeKind.Region` for labels/menus so "Fold All Regions" collapses a script to its label skeleton.
- Command contribution: `renpy-analytics.foldAllLabels` — collapse every label body in the active editor (one-keystroke chapter overview).

### 2.2 Project analysis ("Game Folder Analysis")

Command: `renpy-analytics.analyzeProject`. Auto-detects the `game/` directory (folder containing `script.rpy`/`options.rpy` or any `.rpy` files; configurable via `renpy-analytics.gameDir`). Results surface in three places:

1. **Tree view** in a dedicated Activity Bar container ("Ren'Py Analytics"), grouped: *Inaccessible labels*, *Save-file safety*, *Per-file stats*, *Per-character stats*.
2. **Problems panel** diagnostics (warning severity) on each inaccessible label declaration.
3. **Exportable report** — `renpy-analytics.exportReport` writes Markdown and/or JSON (for CI use).

#### 2.2.1 Inaccessible label detection

Build a directed graph exactly in the spirit of [renpy-graphviz](https://github.com/EwenQuim/renpy-graphviz) (clean-room reimplementation in TypeScript — see §6 licensing):

- **Nodes:** every `label` (including `label .local` labels, resolved against their parent global label).
- **Edges:**
  - `jump target`, `call target` (+ `call target(...)` with args)
  - fall-through: a label whose body ends without `jump`/`return`/`call ... from`-then-return falls through to the next label in file order
  - menu choices — each choice body's jumps/calls
  - `renpy.jump("x")` / `renpy.call("x")` in python blocks (string-literal args only)
  - screen actions: `Jump("x")`, `Call("x")`, `ShowMenu`, `Start("x")`
- **Entry points (roots):** `start`, `splashscreen`, `main_menu`, `before_main_menu`, `after_load`, `quit`, `after_warp`, `hide_windows`, plus any label referenced from `config.label_overrides` and user-configured extras (`renpy-analytics.extraEntryPoints`).
- **Reachability:** labels not reachable from any root are reported *inaccessible*.
- **Dynamic jumps** (`jump expression foo`, `renpy.jump(variable)`): the analysis can't resolve these. Behavior is configurable:
  - `strict` (default): report unreachable labels but tag files containing dynamic jumps so the report notes results may be incomplete.
  - `lenient`: if any dynamic jump exists, downgrade "inaccessible" to "possibly inaccessible" (info severity).
- **Suppression comments**, compatible with renpy-graphviz tag style plus our own:
  - `# renpy-analytics: reachable` on a label line — never report it.
  - Honor `# renpy-graphviz: FAKE_JUMP(target)` / `INGAME_JUMP(target)` style tags as extra edges, so projects already annotated for renpy-graphviz get correct results for free.

#### 2.2.2 Per-file statistics

For every `.rpy` under the game dir (excluding `tl/`, `saves/`, `cache/`, configurable glob excludes):

- **Labels per file** — count of `label` statements.
- **Choice menus per file** — count of `menu:` statements (with total choice count as a sub-metric).

#### 2.2.3 Per-character writing statistics

Character discovery: parse `define x = Character("Name", ...)` (also `DynamicCharacter`, `Character(None)` for narrator variants). Dialogue attribution:

- `e "text"` → character `e`
- `e happy "text"` → character `e` (attribute form)
- bare `"text"` → `narrator`
- `"Name" "text"` → ad-hoc character `Name`
- `extend "text"` → attributed to the previous speaker

Text normalization before counting: strip Ren'Py text tags (`{b}`, `{w=0.5}`, `{color=#fff}` …), count interpolations (`[points]`) as one word, unescape `\"` etc.

Metrics per character:
- **Words** (whitespace-split after normalization) — the "words per character" requirement.
- **Average sentence length** (words ÷ sentences; sentences split on `.` `!` `?` `…` runs, ellipsis-aware).
- Line count and share-of-script % as free extras for the tree view.

#### 2.2.4 Save-file safety report

Ren'Py save files only store variables *changed after init*, and rollback only tracks objects it manages. That produces a family of well-known bugs when games are updated: `define`d values that get changed at runtime, mutable `define` literals mutated in place, and variables created mid-script that don't exist in older saves. These are detected statically and reported both in the analysis tree view and as Problems-panel diagnostics:

| Rule | Trigger | Severity |
|---|---|---|
| `define-mutable-literal` | `define x = []` / `{}` / `set(...)` — in-place changes are never saved or rolled back | warning |
| `define-reassigned` | a `define`d name reassigned at runtime (`$ x = ...` inside a label/screen) | warning |
| `define-mutated` | `.append(...)`/`.update(...)`/attribute assignment on a `define`d object at runtime | warning |
| `missing-default` | variable first created inside a label with no `default` anywhere in the project — loading an older save raises `NameError` when newer code reads it | info |
| `init-variable-changed` | variable assigned in `init python` and changed at runtime without a `default` — init re-runs every start and fights save restoration | warning |

Cross-file: `define`/`default` declarations are resolved project-wide. `persistent.*`, `config.*`, and `_underscore` names are exempt. Suppression: `# renpy-analytics: save-safe` on the same or preceding line. Toggle: `renpy-analytics.saveSafety.enabled`.

**Shipped early in M1** (rather than M2) because the parser already captures every declaration and assignment needed.

### 2.3 Generated comment footer

Command: `renpy-analytics.generateFooter` (per file) and `renpy-analytics.generateAllFooters` (whole project). Appends — or **updates in place, idempotently** — a sentinel-delimited comment block at the end of the `.rpy` file:

```renpy
# ==== renpy-analytics:begin (auto-generated — do not edit; regenerate via VS Code) ====
# File summary — generated 2026-07-06
# Labels: 12 | Menus: 4 (11 choices) | Total words: 3,482
#
# Words per character:
#   e (Eileen): 1,204 | avg sentence 9.3 words
#   l (Lucy): 890 | avg sentence 7.1 words
#   narrator: 1,388 | avg sentence 12.0 words
#
# Classes/functions called:
#   Character, renpy.pause, renpy.random.randint, Jump, SetVariable
#
# Variables referenced:
#   love_sarah, trust, route_flag, persistent.gallery_unlocked
# ==== renpy-analytics:end ====
```

Rules:
- Everything between the sentinels is owned by the extension; regeneration replaces the block, never duplicates it.
- "Classes/variable calls": identifiers used in `$` python one-liners, `python:` blocks, `if`/`while` conditions, screen actions, and `define`/`default` RHS — split into *callables* (followed by `(`) and *variables*. Ren'Py keywords and builtins are filtered via an allowlist.
- Optional setting `renpy-analytics.footer.onSave` (default off) regenerates the footer on save for files that already have one.
- Setting to choose which sections appear (some teams won't want variable lists in shipped scripts).

## 3. Suggested Additional Features (post-MVP)

Chosen to complement (not duplicate) vscode-language-renpy and renpy-magic:

**High value / natural fits**
1. **Story flow graph webview** — interactive route graph including *menu choice nodes* (renpy-magic's graph is label-only), with export to DOT/SVG/PNG. Honors renpy-graphviz style tags (`TITLE`, `GAMEOVER`, `COLOR`…). Optional mode: if the user has the AGPL `renpy-graphviz` binary installed, shell out to it instead (§6).
2. **Choice-consequence CodeLens** — above each menu choice, show what it does: `[+love_sarah] [→ party_scene]`. Direct adaptation of [universal-renpy-walkthrough](https://github.com/BCassO/universal-renpy-walkthrough)'s consequence extraction (MIT — adapt with credit), but static/at-edit-time instead of at runtime.
3. **Dead-end detection** — labels whose flow can terminate without `return`/`jump` into anything (the player would fall off the script); shown alongside inaccessible labels.
4. **Playtime / route-length estimate** — words along each route from `start` to each ending at a configurable reading speed (e.g. 200 wpm); min/max/median route length. Great for pacing.
5. **Unused asset report** — images/audio in `game/` never referenced by `show`/`scene`/`play`/`image` statements or string literals.

**Medium value**
6. **Variable lifecycle diagnostics** — `default`/`define`d variables never read; variables read but never defaulted (a classic Ren'Py save-compatibility bug).
7. **Warp-to-cursor run** — launch the SDK with `--warp file:line` to boot the game directly at the label under the cursor (renpy-magic runs lint but not warp). Setting: `renpy-analytics.sdkPath`.
8. **Translation coverage** — % of dialogue lines with entries under `tl/<lang>/`, listed per file (idea credit: renpy-mcp-pro's feature set; independent implementation).
9. **Label CodeLens** — `N incoming jumps/calls` above each label; click to peek references (uses our graph, no LSP dependency).

**Nice to have**
10. **Dialogue-only spellcheck scope** — export dialogue strings so tools like cSpell can check prose without flagging code identifiers.
11. **Script skeleton outline export** — Markdown outline of labels/menus/choices for sharing with writers who don't use VS Code.

## 4. Architecture

- **Language/runtime:** TypeScript, standard VS Code extension host. No separate LSP process — renpy-magic already runs one; our features are command/provider based and a second LSP adds overhead for no benefit.
- **Single shared parser** (`src/parser/`): line-based, indentation-aware scanner (Ren'Py is a line/indent language; a full grammar is unnecessary). One pass per file produces a `FileModel` (labels, menus+choices, dialogue lines with speaker, python snippets, jump/call edges, screen actions). Every feature — folding, analysis, footer, CodeLens — consumes `FileModel`; nothing re-parses.
- **Workspace index** (`src/index/`): `FileModel` cache keyed by path+mtime/version; invalidated by `FileSystemWatcher` on `**/*.rpy`. Full analysis = graph assembly over cached models, so re-analysis after editing one file is cheap.
- **Graph module** (`src/graph/`): builds the label digraph, reachability (BFS from roots), dead-end detection; serializes to DOT for the webview/export.
- **Metrics module** (`src/metrics/`): text normalization, word/sentence counting, per-character aggregation.
- **Presentation:** TreeDataProvider (activity bar), DiagnosticCollection (Problems panel), FoldingRangeProvider, CodeLensProvider, one webview (graph, post-MVP).
- **Testing:** parser and metrics are pure functions → unit tests with fixture `.rpy` files, including tutorial/the-question scripts from the Ren'Py SDK as realistic corpora.

## 5. Configuration (summary)

| Setting | Default | Purpose |
|---|---|---|
| `renpy-analytics.gameDir` | `""` (whole workspace) | restrict analysis to one folder; set via the *Select Game Folder* picker (detects `options.rpy`/`script.rpy` roots) — needed in monorepos with several game copies |
| `renpy-analytics.exclude` | `["tl/**","saves/**","cache/**"]` | analysis exclusions |
| `renpy-analytics.extraEntryPoints` | `[]` | additional root labels |
| `renpy-analytics.dynamicJumpMode` | `strict` | `strict` \| `lenient` |
| `renpy-analytics.saveSafety.enabled` | `true` | save-file safety diagnostics |
| `renpy-analytics.footer.sections` | all | which footer sections to emit |
| `renpy-analytics.footer.onSave` | `false` | auto-regenerate footers |
| `renpy-analytics.readingSpeedWpm` | `200` | playtime estimates |
| `renpy-analytics.sdkPath` | unset | for warp-to-cursor |

## 6. Licensing & Credits

Extension license: **MIT**.

| Project | License | How we use it |
|---|---|---|
| renpy-graphviz | **AGPLv3** | **No code reuse** (incompatible with MIT distribution). Clean-room TS reimplementation of the label/jump/call graph concept; we *do* adopt its comment-tag conventions for interop and credit it in the README. Optional integration: invoke the user-installed binary as a subprocess (process boundary keeps licenses separate). |
| universal-renpy-walkthrough | MIT | Adapt choice-consequence extraction heuristics for the CodeLens feature, with attribution in README + NOTICE. |
| renpy-mcp-pro | Commercial | Feature inspiration only (dead ends, unused assets, translation stats). No code available/used. |
| vscode-language-renpy | (repo license) | No code reuse needed; we declare it a recommended companion in README. |
| renpy-magic | MIT | No code reuse planned; recommended companion. If we later need its symbol extraction, MIT permits reuse with attribution. |

## 7. Milestones

1. **M1 — Parser + Folding + Save-file safety.** `FileModel` parser with fixture tests; folding provider; save-file safety diagnostics (§2.2.4) with workspace-wide define/default resolution; publish 0.1 (immediately useful standalone).
2. **M2 — Analysis.** Label graph, inaccessible-label diagnostics, tree view, per-file + per-character stats, report export. 0.2.
3. **M3 — Footer generator.** Per-file + project-wide, idempotent updates, settings. 0.3.
4. **M4 — Post-MVP picks.** Choice-consequence CodeLens, dead ends, flow-graph webview, playtime estimates. 0.4+.

## 8. Open Questions

- Marketplace name/publisher ID.
- Should the footer include a content hash so CI can verify footers are up to date?
- Whether to ship the SDK tutorial scripts as test fixtures (Ren'Py's LGPL/MIT-ish licensing likely permits it, verify) or generate synthetic fixtures.
