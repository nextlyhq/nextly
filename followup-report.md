# PR #1393 follow-up — six review findings

Branch `fix/widget-followup`, from merged main at `36d6ab2a1`. One commit per
finding, one changeset for the PR. Not pushed.

| #   | commit      | finding                                                     |
| --- | ----------- | ----------------------------------------------------------- |
| A   | `db7bac834` | setup transformers bypassed widget validation               |
| B   | `f5c2f6f7d` | geo predicates accepted for `count`, rejected at execution  |
| C   | `4274a5fe7` | `select: []` returned every field instead of none           |
| D   | `f132b318d` | duplicate field names aborted the source rebuild mid-flight |
| E   | `42c371c42` | admin widget metadata type was stale                        |
| F   | `6ad5a7f5d` | the type test could not detect a widened contract           |

All six findings were verified against the code before being acted on. None was
mistaken.

## A — where the second validation went, and why

`registerServices` calls `resolvePlugins` (which runs `assertAdminWidgets`)
before `applyPluginConfigTransformers`, then revalidates only slugs on
`setupConfig.plugins`. Reproduced: a transformer adding a plugin whose widget
carries `where: { id: 1n }` booted past every check and failed on the adapter,
not on the widget.

`assertAdminWidgets` now runs a second time on the transformed list, beside the
`validatePluginSlugs` call already there — and the same in the CLI's
`config-loader.ts`, which has the identical shape for the identical reason.

**Validating twice rather than once, deliberately.** The ordering does allow a
single post-transformer check for the runtime path: nothing between the two
points reads a widget. But `resolvePlugins` has three callers —
`di/register.ts`, `cli/utils/config-loader.ts` and
`plugins/plugin-introspection.ts` — and only the first two apply transformers.
Moving the check out would take it away from the third and from any future
caller, and would leave the resolver's own contract ("a config this resolver
accepted is deliverable") false. `validatePluginSlugs` already carries exactly
this duplication for exactly this reason, so widgets are now validated the same
way slugs are rather than differently.

Cost of the duplication: a transformer cannot REPAIR a widget its plugin
declared badly. That is consistent with slugs, and the CLI would refuse such a
config regardless.

## B — the claim was checked before acting on it

`collection-query-service.ts` `countEntries` refuses a geo filter
unconditionally (right after `resolveReadWhere`, before the locale chain):
`extractGeoFilters` finds them and it throws `NextlyError.invalidInput`. So a
well-formed `near`/`within` under `op: "count"` passed the contract and failed
its batch slot.

The `where` walk now carries the op alongside the source and its declared field
names (one `WhereScope` rather than four parallel parameters), so the refusal
reaches every nesting depth a combinator can hide a geo operator at. Keyed on
`GEO_OPERATORS`, not on a hand-kept list of ops.

## C — chose to REJECT `select: []`

Confirmed both halves: `copySelectOrUndefined` preserves `[]` (it is truthy, so
the conditional spread keeps it), `toSelect` maps it back to `undefined`, and
`listEntries` applies a selection only when
`Object.keys(params.select).length > 0`. So "select nothing" became "select
everything".

Rejected at validation rather than given preserving semantics in the executor:

1. The validator already refuses every construct in the same family — `where`
   conditions that are `null` or `{}`, and `and`/`or` with an empty array — on
   exactly this argument: an accepted query that silently widens is the failure
   the gate exists to close. An empty `select` is that family's projection-side
   member.
2. The keys-required rule belongs to the read path and is shared by every caller
   of `nextly.find`. Teaching the widget seam its own reading of `[]` would be a
   second implementation of field selection, not a fix — and the Direct API has
   no representation for "no fields" to preserve.
3. A widget that genuinely wants no fields back asks for `op: "count"`.

## D — yes, the swap was made atomic

Both halves shipped; the second was contained.

- `exposedFields` deduplicates on name, keeping the first declaration. The
  duplicate is real and not author-written: `readableFields` flattens unnamed
  presentational groups into the level they sit in, so a top-level `title` and a
  `title` inside a layout group arrive as two entries with one name.
- `replaceSourcesOfKind` now validates and detaches every member into a staging
  map BEFORE deleting anything, then performs a swap that cannot fail. A refused
  rebuild leaves the previous set standing — the same reading
  `refreshCollectionSources` already takes of a registry it could not reach.

`registerSource` and the staging pass share one `preparedSource`
validate-and-detach step, so they cannot come to disagree about what a usable
source is; only which ids count as taken differs, and a source of the kind being
replaced deliberately does not claim its own id (that is what keeps a rebuild
idempotent).

## E — the `nextly/config` derivation WORKED

`PluginWidgetMeta` is now `export type PluginWidgetMeta = PluginAdminWidget`,
imported from `nextly/config`. `packages/admin` typechecks clean.

Why it is reachable there and not through `"nextly"`: the admin tsconfig maps
only the BARE specifier to `../nextly/src`. Subpaths are not covered by that
mapping, so `nextly/config` resolves through the export map to
`dist/config.d.ts` exactly as a consumer's would — and admin already imports
`SinglePreviewConfig` from it.

`src/config.ts` now re-exports `PluginAdminWidget`, `ComponentPath`,
`HeaderButtonId` and the widget vocabulary. Types only, and taken from the leaf
modules (`domains/widgets/definition`, `/query`, `/sources`) rather than the
`domains/widgets` barrel, which also carries `executeWidgetQuery` and through it
the Direct API — the weight that entry point exists to keep out of a
`nextly.config.ts`. Nothing is added to the runtime bundle.

Divergence is now impossible by construction rather than by convention, and the
docblock says so instead of asserting a synchrony nothing enforced.
`branding.test-d.ts` pins the alias (`toEqualTypeOf<PluginAdminWidget>`) plus the
serialized field set as a `Pick`. Control: flipping one value type in that
assertion fails `tsc` with the expected diagnostic, so the file is genuinely
being checked.

## F — evaluated assertions, in a new `.test-d.ts`

The file the finding named (`widget-exports.test-d.ts`) did not exist; the
passive assertions live in `src/__tests__/export-contract.test.ts`
("publishes every contract a widget definition names"). That test is in
`tsconfig.tests.json`'s include, so it IS compiled — its assertions simply
cannot detect a widening, which is the finding.

New `src/domains/widgets/widget-exports.test-d.ts`, reusing the `Exact<A,B>` /
`assertType<T extends true>` pair from `shared/addressable-fields.test-d.ts`
(restated locally, the way `field-groups-public-surface.test-d.ts` does, rather
than exported from a type-test file). Each union is compared member for member
in both directions, and each carries the three claims a closed union makes as
one tuple: a valid member assignable, `string` NOT assignable, a plausible
near-miss NOT assignable. The refusals need the acceptance beside them, since a
narrowing to `never` refuses everything and would satisfy them alone.

Two things worth recording:

- The file caught a wrong assumption of mine on its first run: I wrote
  `WidgetArchetype` as `"metric" | "chart" | "table" | "list" | "activity" |
"custom"`; the real union is `"metric" | "table" | "list" | "text" |
"actions" | "custom"`.
- The obvious generic helper `ClosedUnion<T, Accepted, NearMiss>` is NOT sound
  here. Inside a generic alias these conditionals are deferred and it evaluated
  to `false` for a HEALTHY union — an instrument that fails on correct code,
  whose obvious remedy is deleting the assertions it broke. Reproduced in
  isolation; the assertions are instantiated directly instead.

Imported through the ROOT entry point, not the domain modules: there is no
`nextly/widgets` subpath, so the root is where a plugin author reaches these, and
a name that stops being re-exported is part of what this catches.

## Break-verifications

| finding    | break                                                                                 | result                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A          | remove the post-transform `assertAdminWidgets`                                        | the new boot test fails; nothing else in `src/di src/plugins src/cli` moves                                         |
| C          | remove the empty-`select` guard                                                       | exactly 2 tests fail (both new) out of 500 in `src/domains/widgets src/api`                                         |
| D (dedup)  | drop the `taken.has` skip                                                             | exactly the 2 new built-in-sources tests fail                                                                       |
| D (atomic) | restore delete-then-register                                                          | exactly the 1 new sources test fails                                                                                |
| F          | widen `WidgetHeight`, `WidgetSize`, `WidgetArchetype`, `WidgetOp` to `string` in turn | 2 assertions fail in the new file for each; `export-contract.test.ts`'s example assignment is untouched by all four |

B was not on the break-verify list; its five tests were written first and three
failed before the fix, two (the controls) passed.

## Test counts

| suite                                                 | result                                                              | baseline                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `packages/nextly` `pnpm test`                         | **841 files, 10386 passed, 42 skipped, 0 failed**                   | 840 / 10370                                   |
| `packages/admin` `pnpm test`                          | **335 files, 3201 passed, 7 failed**                                | 7 failures all in `BrandingProvider.test.tsx` |
| root `pnpm check-types`                               | 22/22 successful                                                    | —                                             |
| root `pnpm test:integration:sqlite`                   | 19/19 tasks; `nextly` 239 files, 1440 passed, 213 skipped, 0 failed | —                                             |
| `turbo lint --filter=nextly --filter=@nextlyhq/admin` | 2/2 successful, `--max-warnings 0`                                  | —                                             |

`packages/nextly` gains one file (the new boot test; the `.test-d.ts` is not
collected by vitest) and 16 tests: A 2, B 5, C 4, D 5.

The admin failures are the known-red `BrandingProvider.test.tsx` this work was
told to ignore. The E change to that package is types-only — an interface
becoming a type alias, plus a type-only import — so the emitted JavaScript is
unchanged and cannot reach a runtime test.

## fallow

`fallow audit --base origin/main --gate-marker agent`: **pass**, 14 changed
files, 0 introduced findings of any kind (36 dead-code / 8 complexity / 9
duplication all inherited).

Two intermediate `warn` verdicts were resolved rather than waved through: both
were `duplication_introduced` on the boilerplate shape of consecutive
`expectTypeOf` / `assertType` lines, and both were fixed by collapsing several
one-field assertions into one assertion over the whole set — which reads better
anyway.
