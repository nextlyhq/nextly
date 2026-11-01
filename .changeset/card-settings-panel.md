---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

A card's More settings opens a side panel that shows the card as it will look, beside a dashboard that stays usable.

- **The panel is not modal.** The dashboard behind it can still be read and clicked, and clicking it does not close the panel. The panel is 480 to 560 px wide, and full width on a phone.
- **A live preview at the top** draws the card at the size tier its real width gives it, scaled down to fit when the card is wider than the panel.
- **The settings are grouped into Data, Display and Advanced**, and Advanced starts folded. Each section shows only what the widget declares, and Display always holds the card's title. Each section has its own Reset to defaults link.
- **Filters are chips** ("Title is Hello ✕"). A card can have several, joined with AND, and "+ Add filter" adds one. One condition is stored as before; two or more are stored under `and`. The fields offered are still only those of the chosen collection that no read rule can refuse.
- **Changing the collection says what it reset**, beside the Collection field: "Changing the collection reset Filter and Sort".
- **The preview says "No entries match these filters"**, with Clear filters, when the panel's filters match nothing.
- **Done saves and Cancel or Escape discard.** Leaving the page with changes still in the panel asks first, with the admin's usual Save, Discard and Keep editing. While customising, the dashboard's own prompt asks instead, so a leave is asked about once. Its Save keeps an open panel's change in the saved arrangement, as the panel's Done would. If the panel would refuse that change (a title too long, a filter begun and not finished), Save stops and nothing is saved: the panel says what to fix, with focus on it. Discard drops both.
- **A filter begun and not finished is refused on Done**, with "Finish this filter, or remove it." Before, it was saved without that filter.
- **One panel at a time.** Opening another card's settings closes a panel with nothing unsaved. A panel holding a change asks first, and the other card's panel opens only once the reader has answered.
- **A card's automatic title** names its subject and its range ("Posts · last 30 days"), with the widget's name beneath it ("Over time").

Published additions (all `patch`):

- **`section`** on a widget setting: `"data"`, `"display"` or `"advanced"`, accepted by every setting builder, and refused at startup when it is anything else. Unset, a setting over the card's content (Collection, Filter, Sort, Group by, Field) and a date range are drawn under Data, and every other setting under Display. A setting goes under Advanced only when it says so. Core's list cards fold their Density there.
- **`title`** on a dashboard placement: the title a reader gives one card. It is trimmed, holds at most 80 characters, and is checked by the same layout write as the rest of the placement. Empty or absent means automatic.
- **`MAX_CARD_TITLE_LENGTH`** from `nextly/config`: the bound the layout write applies to that title, so the admin's field uses the same number.
