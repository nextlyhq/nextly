---
"@revnixhq/admin": minor
---

Repeater field improvements:

- The "Collapsed row title" knob (`rowLabelField`) is now actually wired
  in the renderer. Previously the Builder wrote the value but the renderer
  ignored it; collapsed rows always fell through to auto-detect or generic
  "Item N" labels. Setting an explicit field (e.g. `question` on an FAQ
  repeater) now displays that field's value as each row's collapsed title.
- Schema Builder Repeater editor copy refreshed: clearer section headers
  ("Row labels", "Collapsed row title"), plain-English helper text under
  each, and a live-preview block showing the rendered Add button, empty
  state, validation messages, and example collapsed rows so the effect of
  each knob is visible without leaving the editor.
- The auto-detect dropdown option is relabeled "Auto-detect (recommended)"
  to surface that the renderer falls back to common field names (title,
  name, label, heading, subject) when no explicit field is chosen.

`labels.singular` and `labels.plural` continue to drive the Add button
text, empty-state copy, and validation messages — unchanged behaviour, just
with live preview in the editor now.
