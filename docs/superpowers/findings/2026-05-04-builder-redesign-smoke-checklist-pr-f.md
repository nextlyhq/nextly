# Builder Redesign Smoke Checklist (PR F)

**Date:** 2026-05-04
**Scope:** Manual smoke for PRs A through E4. Run against any dev sandbox (`apps/playground` or a `create-nextly-app`-scaffolded project linked via yalc).

For each section, perform the action and verify the expected behavior. Tick the box when verified.

## A. Lifecycle

- [ ] Navigate to /admin/collections, click "Create collection", scaffold a Collection named "Articles" with default settings, save. Verify it appears in the listing.
- [ ] Open the Articles builder. Verify the BuilderToolbar at top, BuilderFieldList in body. Add a `text` field named "headline", save. Reload the page, verify "headline" persisted.
- [ ] Same flow for a Single named "homepage".
- [ ] Same flow for a Component named "hero".

## B. Settings Modal v2 (PR B)

- [ ] Open Settings modal on Articles. Verify 50/50 grid layout. Singular name "Article" auto-derives plural "Articles".
- [ ] Edit slug via the Pencil icon. Verify it stays read-only until clicked.
- [ ] Toggle "Show System Fields" -- verify the system fields chip row appears/disappears in the field list.

## C. Field Picker v2 (PR C)

- [ ] Click "+ Add field" in the toolbar. Verify the FieldPickerModal opens with categorized field types and per-type icons.
- [ ] Search for "select". Verify the picker filters.
- [ ] Click "Select". Verify the FieldEditorSheet opens in `create` mode (not committing yet). Cancel and verify the field is NOT added.
- [ ] Repeat, but click "Add field" in the sheet footer to commit. Verify it appears in the list.

## D. Field Editor Sheet (PR E1 + E2)

- [ ] Click an existing field card. Verify the sheet opens with the name on the left and a "type · width%" chip on the right.
- [ ] Verify 4 tabs: General, Validation, Display (NOT "Admin"), Advanced.
- [ ] Validation tab: verify min/max length live in a 50/50 grid for text-style fields.
- [ ] Advanced tab: verify NO "Index" toggle, and "Localized" shows a "Coming Soon" chip.
- [ ] General tab: type a Label, verify Name auto-derives via toSnakeName until you manually edit Name.
- [ ] On a relationship field, verify the label is "Link to" (not "Target Collection(s)"). Select 2 collections; verify it becomes polymorphic (badge per collection).
- [ ] Open the Display tab on any field. Add a conditional visibility rule pointing at another field in the form. Save. Open the entry creation form for the collection -- verify the dependent field is hidden until the source field's value satisfies the rule.

## E. Per-type knobs (PR E3)

- [ ] **Tri-state boolean default:** add a `boolean` field. In Default Value, verify three radios appear (True / False / Unset). Pick each and save; reopen and verify roundtrip. Pick Unset, save, then inspect the saved field schema (via the API or admin UI) -- the `defaultValue` key should be absent.
- [ ] **Unique disabled when nested in repeater:** add a `repeater` field. Add a child `text` field. Edit the child. In Advanced tab, verify the Unique switch is DISABLED with the help text "Unique can't be enforced inside a repeater or repeatable component...".
- [ ] **Unique still enabled in group:** add a `group` field with a `text` child. Edit the child. Verify Unique IS enabled (counter-test).
- [ ] **Select Clearable + Placeholder:** add a `select` field with 2 options. In its editor, toggle Clearable off, type Placeholder "Choose a category". Save and reopen; verify roundtrip.
- [ ] **Radio layout:** add a `radio` field with 2 options. Switch Layout to Vertical. Save and reopen; verify roundtrip.
- [ ] **Relationship Appearance:** add a `relationship` field. Switch Appearance to Drawer. Save and reopen; verify roundtrip.

## F. Options polish (PR E4)

- [ ] Add a `select` field. In the Options section, verify the empty state is a single muted line "No options yet -- click + Add or Import above." (NO dashed box, NO big icon, NO "Add first option" button).
- [ ] Same empty state on `radio` and `checkbox` field types.
- [ ] Click Import. Verify CSV and JSON appear as Tabs (not big buttons). Default tab is CSV.
- [ ] Switch tabs; verify each tab's helper text changes (CSV vs JSON descriptions). Type into one tab, switch to the other, switch back -- text persisted.
- [ ] Paste valid CSV `Draft,draft\nPublished,published`, click Import; verify two options append.
- [ ] Paste invalid JSON `{not json}`, click Import; verify red error message renders below the textarea.

## Out of scope (don't smoke here)

- Schema migration preview dialog.
- Hooks UI (removed in PR D).
- Code-first locked collections (readOnly mode).
- The `blocks` field type (deferred per Q3).
