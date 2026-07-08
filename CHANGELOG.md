# Changelog

## 0.7.0

- **Prose pipeline** — the `.rpy` stays the source of truth; prose flows in once, dialogue text round-trips by anchor:
  - **Ren'Py: Paste as Ren'Py Dialogue**: converts clipboard screenplay cues, `Name: line` chat format, narration paragraphs, and Fountain-flavored logic (`? prompt`, `+ [Label]` choices, `-> #target` jumps, `~ expr` state, `! BG:/SHOW:/MUSIC:/SFX:` assets) into proper Ren'Py script at the cursor. Speakers are matched to `Character(...)` defines, with a QuickPick for unknowns.
  - **Ren'Py: Export Dialogue for Proofreading**: anchored Markdown of all dialogue — whole project or current file only (`<filename>-proofread.md`) — grouped by file and label; share it, edit it anywhere.
  - **Ren'Py: Apply Proofread Dialogue**: applies the edited text back by `<!-- file:line -->` anchor; only dialogue strings change, moved/edited code lines are skipped and reported.

## 0.6.1

- README: screenshots for the flow graph, panes, and CodeLens.

## 0.6.0

- **Flag & variable explorer**: new *Variables* pane indexing every story variable — declarations, writes (annotated with enclosing label and triggering menu choice), reads with gate detection, and orphan groups (*Gated but never set*, *Never read*).
- Flow graph: edges leaving `if`/`elif`/`while` blocks carry the condition as an edge label (webview + DOT export); choice nodes show their consequence summary on hover.

## 0.5.0

- **Ren'Py: Playtest From Here** (command palette + editor context menu): launches the game warped to the line under the cursor via the SDK's `--warp`. Auto-detects `renpy-*-sdk` installs; the pick is saved to `renpy-analytics.sdkPath`.

## 0.4.0

- **Choice-consequence CodeLens** above every menu choice: stat changes, function calls, and jump/call destinations.
- **Story flow graph** webview (whole project or current file) with pan/zoom, click-to-open, and Graphviz DOT export.
- **Dead-end detection**: reachable labels whose flow runs off the end of the file.
- **Current File pane**: per-file writing and narrative stats — reading time, pacing, characters, scenes, connections.
- **Playtime estimate** for all reachable dialogue.
- Fold-all commands for labels, menus, and both.

## 0.3.0

- **Generated file footers**: per-file summary comment blocks (labels, words per character, callables, variables), idempotent regeneration, optional refresh-on-save.

## 0.2.0

- **Project analysis**: label flow graph across the workspace, inaccessible-label detection, per-file and per-character statistics, speaker-consistency findings, Markdown/JSON report export, game-folder scoping.

## 0.1.0

- **Structural folding** for labels, menus, choices, screens, and init/python blocks.
- **Save-file safety diagnostics**: mutable `define` literals, `define` reassignment/mutation, missing `default`, init-variable changes.
