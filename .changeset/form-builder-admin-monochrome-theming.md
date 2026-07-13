---
"@nextlyhq/plugin-form-builder": patch
---

Align the form-builder admin UI with the Nextly admin design system. The builder, field editor, settings, notifications, and the submissions filter now derive every color, border, and radius from the admin design tokens instead of a fixed light palette, so the plugin follows the admin theme correctly in both light and dark mode. Non-monochrome accents (blue, purple, green, amber used for general UI) are replaced with monochrome tokens or the shared semantic tokens where they carry meaning, focus rings and toggles are monochrome, and rounded corners follow the admin's sharp-corner radius. The previously washed-out light filter bar in dark mode is fixed.
