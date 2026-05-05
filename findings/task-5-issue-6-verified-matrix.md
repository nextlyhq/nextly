# Task 5 Issue 6 — verified matrix (architectural pass)

The Issue 6 list in [`tasks/admin-ui-tasks/05-content-manager-feedback.md`](../../tasks/admin-ui-tasks/05-content-manager-feedback.md) catalogued a wide field-by-field set of "X knob doesn't work on Y scope" reports. This doc walks each report against the architecture as it stands after PRs 1–9 of the Task 5 rework.

**Disclaimer.** This is an _architectural_ pass: I'm reading code paths, not running each combination through a fresh Playwright suite. The audit subagents that produced [`task-3-builder-renderer-parity-matrix.md`](task-3-builder-renderer-parity-matrix.md) confirmed that collections, singles, and components-as-fields all share one `FieldRenderer` dispatcher, one `generateClientSchema` Zod builder, and one `FieldWrapper` chrome — so per-scope divergence is rare and localised. Each row below is marked:

- **Pass (architectural)** — code path is correct after the relevant PR; live re-test before closing the report
- **Pending live verification** — should work after the architectural fixes; needs an empirical n5 run
- **Wontfix / deferred** — intentional non-coverage with a documented reason
- **Open follow-up** — genuine gap not addressed by this rework; tracked for a separate PR

A focused Playwright suite locking each combination is the natural next follow-up; that's PR 10b in the Task 5 series and lands after the user confirms n5 is back in a working state for live runs.

## Matrix

### Text field

| Report                                                          | Status                   | PR                     | Notes                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description not rendering on Collections / Singles / Components | **Pass (architectural)** | PR 1 + PR 5            | PR 1 fixed the Builder write-path data-shape mismatch (`field.description` → `field.admin.description`). PR 5 changed the renderer from tooltip-on-info-icon to plain helper text below the input. Both surfaces now share `FieldWrapper` so all three scopes inherit the fix.                                                                                                     |
| Pattern validation not working on Components                    | **Pass (architectural)** | PR 7 (existing wiring) | The existing `generateClientSchema` already routed pattern validation through every scope (text/textarea PR 8 in Task 3). PR 7 verified the public types now expose `validation: { pattern, message }` so code-first config in component schemas type-checks cleanly. Components inherit the same pipeline. Re-test live to confirm the API enrichment carries the validation key. |
| Custom error message not showing in Components                  | **Pass (architectural)** | PR 7                   | `getPatternMessage` reads `validation.message` regardless of scope. Same pipeline.                                                                                                                                                                                                                                                                                                 |
| Unique not working on Components                                | **Wontfix / deferred**   | —                      | `unique` is server-side only by design; client-side mirroring was never wired and is out of scope for the current rework. Tracked as a separate effort.                                                                                                                                                                                                                            |

### Number field

| Report                                                  | Status                   | PR          | Notes                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description issue same as Text                          | **Pass (architectural)** | PR 1 + PR 5 | Same root cause; same fix.                                                                                                                                                                                                                                                                                                                                    |
| Required not working on Collections                     | **Open follow-up**       | —           | `convertNumberFieldToZod` reads `getValidation(field, "required")` (covered by `fieldToZodSchema`'s outer required-vs-optional gate). Should already work — the report likely surfaces because the user-defined Number field's required wasn't being saved by the Builder UI (the description bug pattern). Worth a focused empirical check after PR 1 lands. |
| Default value not working on Collections                | **Open follow-up**       | —           | Default values flow through React Hook Form's `defaultValues`. If broken, the issue is upstream in how the entry create page seeds the form, not in the renderer. Needs an n5 reproduction.                                                                                                                                                                   |
| Pattern validation not working on Collections / Singles | **Open follow-up**       | —           | Number fields don't have a string `pattern` — they have `min` / `max` numeric bounds. If the user expected regex on a Number field, that's an unsupported combination. If they meant `min` / `max`, those ARE wired in `convertNumberFieldToZod`. Clarify with the user before fixing.                                                                        |
| Custom error message not working for Singles            | **Open follow-up**       | —           | Custom error messages on Number's `min` / `max` use generic strings today (`"Must be at least N"`). Surfacing `validation.message` for numeric bounds would be a small enhancement.                                                                                                                                                                           |
| Conditional visibility not working for Singles          | **Pass (architectural)** | —           | `FieldRenderer.useWatch` evaluates `admin.condition` for all field types in all scopes. Live verification expected to pass after PR 5 (so the description renders too — many "doesn't work" reports trace back to "I never see the description so I assume the rest is broken").                                                                              |
| Unique not working for Singles                          | **Wontfix / deferred**   | —           | Same as Components — server-side only by design.                                                                                                                                                                                                                                                                                                              |
| Default value should receive numeric only               | **Open follow-up**       | —           | Defensible enhancement — coerce the input to a number before applying as default. Small follow-up.                                                                                                                                                                                                                                                            |

### Code field

| Report                                                | Status                   | PR          | Notes                                                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Description: All 3 scopes                             | **Pass (architectural)** | PR 1 + PR 5 | Same root cause; same fix.                                                                                                                                                                                   |
| Default value: Collections + Singles                  | **Open follow-up**       | —           | Default value flow same as Number — needs empirical reproduction.                                                                                                                                            |
| Pattern validation + custom error message: Components | **Pass (architectural)** | PR 7        | Code field's `convertCodeFieldToZod` now wires `validation.pattern` + `validation.message` through the same `applyPattern` helper as text/textarea (PR 7). Components inherit via `FieldRenderer` recursion. |
| Unique: Singles + Components                          | **Wontfix / deferred**   | —           | Same as above.                                                                                                                                                                                               |
| Conditional visibility: Components                    | **Pass (architectural)** | —           | Same shared `useWatch` path.                                                                                                                                                                                 |

### Date field

| Report                                                    | Status                   | PR          | Notes             |
| --------------------------------------------------------- | ------------------------ | ----------- | ----------------- |
| Description: All 3 scopes                                 | **Pass (architectural)** | PR 1 + PR 5 |                   |
| Conditional visibility: Single, not sure about Components | **Pass (architectural)** | —           | Same shared path. |
| Unique: Components, not sure about Single                 | **Wontfix / deferred**   | —           | Server-side only. |

### Select field

| Report                                                                   | Status                   | PR          | Notes                                                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description: All 3 scopes                                                | **Pass (architectural)** | PR 1 + PR 5 |                                                                                                                                                            |
| Component: Pattern, custom error message, conditional visibility, unique | **Mixed**                | —           | Pattern + message: Select doesn't support regex (the value space is enum-bound). Conditional: same shared path → Pass. Unique: server-side only → Wontfix. |

### Editor (richText) field

| Report                                                               | Status                   | PR          | Notes                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description: All 3 scopes                                            | **Pass (architectural)** | PR 1 + PR 5 |                                                                                                                                                                                                                                                                                                         |
| Required: Collections                                                | **Open follow-up**       | —           | richText currently returns `z.unknown()` from `convertRichTextFieldToZod` since Lexical's serialised state shape varies. Required gating doesn't run because the schema accepts anything. Real fix: branch on a "rich text is empty" heuristic (no nodes, or only an empty paragraph). Small follow-up. |
| Default value: Collections + Single                                  | **Open follow-up**       | —           | Same as Number — needs empirical reproduction.                                                                                                                                                                                                                                                          |
| Min length / Max length: Components                                  | **Wontfix**              | —           | richText doesn't have a meaningful character count without serialising. Rejected as a feature.                                                                                                                                                                                                          |
| Min rows / Max rows: All 3                                           | **Wontfix**              | —           | Same — richText isn't an array. The Builder shouldn't expose these knobs for richText; that's a Builder UI cleanup, not a renderer fix.                                                                                                                                                                 |
| Pattern, custom error message, conditional visibility, unique: All 3 | **Mixed**                | —           | Pattern: doesn't apply to richText. Custom error: only applies if pattern applies. Conditional: same shared path → Pass. Unique: server-side only → Wontfix.                                                                                                                                            |

### Email field

| Report                                                                      | Status                   | PR           | Notes                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description: All 3 scopes                                                   | **Pass (architectural)** | PR 1 + PR 5  |                                                                                                                                                                                                                                                                                                 |
| Default value: All 3                                                        | **Open follow-up**       | —            | Same shape as Number / Code default-value reports. Needs empirical reproduction.                                                                                                                                                                                                                |
| Min length / Max length / Unique: All 3                                     | **Open follow-up**       | —            | `convertEmailFieldToZod` returns `z.string().email(...)` with no length wiring. EmailFieldConfig doesn't expose minLength/maxLength either. If users want length bounds on emails, the field type config and converter both need the knob. Small follow-up. Unique stays Wontfix.               |
| Pattern, custom error message, conditional visibility: Singles + Components | **Pass (architectural)** | PR 7 (types) | Email's `validation.pattern` now type-checks via PR 7's public `FieldValidation` interface. The renderer doesn't wire pattern on email today (pattern would compose with the email regex). If the user wants additional regex on email, the converter needs a small extension — open follow-up. |

### Long Text (textarea) field

| Report                                                                      | Status                   | PR              | Notes                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description, Unique: All 3                                                  | **Pass + Wontfix**       | PR 1 + PR 5 / — | Description fixed; Unique stays server-side.                                                                                                                                     |
| Required: Collections                                                       | **Open follow-up**       | —               | Same investigation as Number.                                                                                                                                                    |
| Default value: Collections + Single                                         | **Open follow-up**       | —               | Same.                                                                                                                                                                            |
| Min rows / Max rows: Collections + Singles                                  | **Open follow-up**       | —               | Textarea's "rows" config controls visible row count, not array bounds. If Builder exposes `minRows` / `maxRows` for textarea, that's a Builder UI inconsistency. Worth checking. |
| Pattern, custom error message, conditional visibility: Components + Singles | **Pass (architectural)** | PR 7            | Textarea pattern was wired in Task 3 PR 8; PR 7 added F1 (optional + empty). Same shared pipeline across all three scopes.                                                       |

### Password field

| Report                                                           | Status                   | PR                 | Notes                                                                                       |
| ---------------------------------------------------------------- | ------------------------ | ------------------ | ------------------------------------------------------------------------------------------- |
| Description, default value, pattern, custom error message: All 3 | **Pass (architectural)** | PR 1 + PR 5 + PR 7 | PR 7 added pattern + message wiring on password fields. Default value is the open question. |
| Conditional visibility: Components + Singles                     | **Pass (architectural)** | —                  | Same shared `useWatch` path.                                                                |
| Unique: Singles + Components                                     | **Wontfix / deferred**   | —                  | Server-side only.                                                                           |

### Repeater field (formerly Array)

The user's Q1 question on Repeater knobs was addressed in PR 6: `rowLabelField` now wires through to the renderer, and the Builder editor copy + live preview surfaces the effect of `labels.singular` / `labels.plural` clearly. No Issue 6 row corresponds directly here, but it's the answer to "what does each knob do at runtime."

## Approach for the next pass

After the user confirms n5 is back in a stable state (auth recovered, fresh seed, fresh yalc), the recommended pass is:

1. Build a `qa_matrix` collection covering one of each field type + every relevant knob.
2. Open a Playwright test suite at `apps/admin-e2e/tests/field-knobs.spec.ts` (path TBD when the suite location is established) that loads each create + edit page and asserts the documented behaviour.
3. For each row above marked **Pending live verification** or **Open follow-up**, attach the empirical result (Pass / Fail) and link the follow-up PR for any genuine Fail.

This document is the architectural baseline; the empirical matrix builds on top of it.

## Cross-references

- Design doc: [`task-5-content-manager-rework-design.md`](task-5-content-manager-rework-design.md)
- Builder ↔ renderer parity (Task 3): [`task-3-builder-renderer-parity-matrix.md`](task-3-builder-renderer-parity-matrix.md)
- PR 8 of Task 3 deferred audits: [`task-3-pr-8-deferred-audits.md`](task-3-pr-8-deferred-audits.md)
- Plan: [`plans/task-5-content-manager-rework.md`](../plans/task-5-content-manager-rework.md)
