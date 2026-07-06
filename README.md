# Ren'Py Analytics

Structure folding, save-file safety checks, and (coming) story-flow analysis and writing metrics for [Ren'Py](https://www.renpy.org/) projects in VS Code.

Designed as a **companion** to [vscode-language-renpy](https://github.com/renpy/vscode-language-renpy) (highlighting, completion, navigation) and [renpy-magic](https://github.com/adiffx/renpy-magic) (LSP: rename, references, lint). This extension deliberately stays out of their lanes — its focus is story structure, reachability, and writing statistics. See [SPEC.md](SPEC.md) for the full roadmap.

## Features (0.1 — M1)

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
