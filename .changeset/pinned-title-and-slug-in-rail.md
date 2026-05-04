---
"@revnixhq/admin": patch
---

Title and slug move to their final redesign positions:

- **Title** is now a pinned, borderless 28px headline above the field grid (think Notion, GitHub PR titles, Linear issues).
- **Slug** moves from the old top Card into the rail's Document panel, shown as the first row with an inline pencil-to-edit affordance.

The previous Title + Slug Card is removed. Both fields are still excluded from the main field grid; FieldRenderer is never called for them.
