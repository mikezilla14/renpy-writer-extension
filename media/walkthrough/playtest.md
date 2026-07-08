# Playtest From Here

Put the cursor on the line you want to see, run the command (also in the editor right-click menu), and the game launches **warped directly to that line** via the Ren'Py SDK's `--warp`.

- First run: the extension auto-detects installed `renpy-*-sdk` folders, or lets you browse; the pick is saved to `renpy-analytics.sdkPath`
- Warp requires `config.developer` (Ren'Py enables it by default for un-built projects)
- Define an `after_warp` label in your game to seed variables for warped scenes
