---
"@revnixhq/admin": patch
---

Restyle the API Keys create-page alerts and access preview to feel less "AI-generated":

- Token Type contextual alert: drop the per-type colour hierarchy (subtle grey for read-only, amber for full-access, etc.) and use a single subtle shared `Alert` with `variant="info"` for all three types — the descriptor text already explains the risk.
- "What can this key access?" expanded section: replace the comma-separated sentence with a pill/chip list so resources are easy to scan.
- API key reveal modal: replace the inline amber/yellow warning banner with the same shared subtle `Alert` for visual consistency.
