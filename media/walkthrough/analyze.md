# Analyze Project

One command scans every `.rpy` file in the workspace and reports:

- **Inaccessible labels** — scenes no jump, call, or screen action can reach
- **Dead ends** — labels whose flow runs off the end of the file (a runtime error)
- **Save-file risks** — `define`d lists that get mutated, variables without `default`, and other classic footguns
- **Writing metrics** — words, dialogue lines, and sentence length per file and per character

Findings land in the **Problems panel** and the **Ren'Py Analytics** views in the activity bar. The analysis also re-runs automatically as you edit.
