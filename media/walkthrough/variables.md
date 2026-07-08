# Variables

The **Variables** pane replaces the flag-tracking spreadsheet:

- Every story variable with its declaration, **every write** (annotated with the menu choice that triggers it), and **every read** — condition reads marked as *gates*
- **Gated but never set** — conditions check this flag, but nothing ever assigns it: that branch can never trigger
- **Never read** — flags written and then forgotten

Click any site to jump to it. Engine config (`config.*`, `gui.*`, …) and `Character(...)` defines are filtered out automatically.
