# Ren'Py Analytics

Structure folding, save-file safety checks, and (coming) story-flow analysis and writing metrics for [Ren'Py](https://www.renpy.org/) projects in VS Code.

Designed as a **companion** to [vscode-language-renpy](https://github.com/renpy/vscode-language-renpy) (highlighting, completion, navigation) and [renpy-magic](https://github.com/adiffx/renpy-magic) (LSP: rename, references, lint). This extension deliberately stays out of their lanes — its focus is story structure, reachability, and writing statistics. See [SPEC.md](SPEC.md) for the full roadmap.

## Features (0.3 — M1–M3)

### Structural folding

Real folding ranges for `.rpy`/`.rpym` files — not indentation guessing:

- `label` bodies (which end at the *next* top-level statement, something indentation folding gets wrong)
- `menu` blocks and each individual choice
- `screen`, `init`, `init python`, and `python` blocks

Command: **Ren'Py: Fold All Labels** — collapse the active file to its label skeleton.

### Save-file safety diagnostics

Ren'Py only stores variables *changed after init* in save files, and rollback only tracks what it knows about. This extension statically detects the classic footguns and reports them in the Problems panel:

| Rule | Example | Why it's a risk |
|---|---|---|
| `define-mutable-literal` | `define inventory = []` | In-place changes to a define'd list/dict/set are not saved and not rolled back |
| `define-reassigned` | `define max_hp = 100` … `$ max_hp = 200` | `define` is for constants; runtime changes break rollback/save-load assumptions |
| `define-mutated` | `$ inventory.append("sword")` | The mutation silently disappears on save/load |
| `missing-default` | `$ mood = "happy"` with no `default mood = ...` | Older saves loaded into a newer build hit `NameError` when the variable is read before that line runs |
| `init-variable-changed` | `init python: chapter = 1` … `$ chapter = 2` | Init assignments re-run on every start and fight with values restored from saves |

Suppress a finding with a comment on the same or preceding line:

```renpy
define palette = []  # renpy-analytics: save-safe
```

Disable entirely with the `renpy-analytics.saveSafety.enabled` setting. Run on demand across the workspace with **Ren'Py: Analyze Save-File Safety (Workspace)**.

### Project analysis

**Ren'Py: Analyze Project** builds a label flow graph across the whole workspace (jumps, calls, menu-choice bodies, fall-through, `renpy.jump("…")`, and screen actions like `Jump("x")`) and reports:

- **Inaccessible labels** — labels unreachable from any entry point (`start`, `splashscreen`, `after_load`, screen actions, …). Reported in the Problems panel and the **Ren'Py Analytics** activity-bar view. Dynamic jumps (`jump expression …`) are counted and noted, since they make reachability undecidable — set `renpy-analytics.dynamicJumpMode` to `lenient` to downgrade findings when they exist, or tag intentionally-dynamic targets with `# renpy-analytics: reachable`.
- **Per-file statistics** — labels, menus, choices, and words per file.
- **Per-character statistics** — words, dialogue lines, and average sentence length per character (Ren'Py text tags stripped; `extend` lines attributed to the previous speaker; narrator tracked separately). Ad-hoc string speakers (`"Name" "dialogue"`) are distinct characters in Ren'Py and are labeled `"Name" (string speaker)` so they can't be mistaken for a defined Character.
- **Speaker consistency** — a `duplicate-speaker` finding (Problems panel + tree view) whenever a string speaker matches a defined character's display name or variable, e.g. `"Lady Eleanor" "..."` in a script that defines `lady_eleanor = Character("Lady Eleanor")`. Usually an authoring slip — the string form ignores the Character's styling and splits word counts. Suppress intentional distinct voices with `# renpy-analytics: string-speaker` on or above the line.

**Ren'Py: Export Analysis Report** writes the full analysis as Markdown (for humans) or JSON (for CI).

Entry points can be extended with the `renpy-analytics.extraEntryPoints` setting.

### Generated file footer

**Ren'Py: Generate File Footer** (or **… for All Files**) appends a summary comment block to the end of a script:

```renpy
# ==== renpy-analytics:begin (auto-generated - do not edit; regenerate via VS Code) ====
# File summary - generated 2026-07-06
# Labels: 12 | Menus: 4 (11 choices) | Total words: 3,482
#
# Words per character:
#   e (Eileen): 1,204 words | avg sentence 9.3
#   narrator: 1,388 words | avg sentence 12.0
#
# Classes/functions called:
#   Character, bonus_points, renpy.pause
#
# Variables referenced:
#   mood, route_flag, trust
# ==== renpy-analytics:end ====
```

Regeneration replaces the block in place — never duplicates it — and preserves the file's line endings. Configure which sections appear with `renpy-analytics.footer.sections`; enable `renpy-analytics.footer.onSave` to auto-refresh footers on save (only in files that already have one).

### Scoping to one game folder

By default every `.rpy` in the workspace is analyzed. In a monorepo with several copies of a game (e.g. `prod/` and `nonprod/`), run **Ren'Py: Select Game Folder** — it detects candidate game roots (folders containing `options.rpy`/`script.rpy`) and saves your pick to the workspace setting `renpy-analytics.gameDir`. The current scope is shown at the top of the Ren'Py Analytics view; click it to change.

## Development

```sh
npm install
npm run compile   # type-check + build to out/
npm test          # unit tests (vitest)
```

Press F5 in VS Code to launch an Extension Development Host.

## Credits

- Story-graph concepts and annotation-tag conventions inspired by [renpy-graphviz](https://github.com/EwenQuim/renpy-graphviz) (AGPLv3 — no code reused; independent TypeScript implementation).
- Choice-consequence analysis ideas (planned) adapted from [universal-renpy-walkthrough](https://github.com/BCassO/universal-renpy-walkthrough) (MIT).

## License

MIT
