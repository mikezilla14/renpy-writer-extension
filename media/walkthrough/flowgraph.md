# Story Flow Graph

Your whole story as an interactive map:

- **Label nodes** and **menu-choice nodes**, connected by jump/call/fall-through edges
- **Entry points** outlined green, **unreachable scenes** red
- Edges leaving an `if` block show the **condition** that gates them
- Hover a choice to see what it does — flags set, calls made, destination

Drag to pan, scroll to zoom, click any node to open it in the editor. Use **Ren'Py: Show Story Flow Graph (Current File)** to scope the map to one script, or export as Graphviz DOT.
