# Structural Folding

Real folding ranges built from Ren'Py structure — not indentation guessing:

- `label` bodies end at the *next top-level statement* (indentation folding gets this wrong)
- `menu` blocks fold as a unit, and each choice folds individually
- `screen`, `init`, and `python` blocks fold too

**Fold All Labels** gives you the chapter skeleton. **Fold All Menus** hides branching while you read prose. Unfold everything with `Ctrl+K Ctrl+J`.
