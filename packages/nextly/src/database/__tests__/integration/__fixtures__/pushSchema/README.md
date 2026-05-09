# pushSchema fixtures

JSON snapshots of `drizzle-kit pushSchema` output. Used as regression
fixtures for the RenameDetector (F4) and the unified pipeline (F8).

## Filename convention

`<scenario>-<dialect>-drizzle-kit-<version>.json`

Examples:

- `add-field-postgresql-drizzle-kit-0.31.10.json`
- `rename-field-mysql-drizzle-kit-0.31.10.json`
- `multi-rename-sqlite-drizzle-kit-0.31.10.json`

## Why include the drizzle-kit version

drizzle-kit's pushSchema output format can change between versions.
Keeping the version in the filename means:

1. Stale fixtures are visible at a glance.
2. PR reviewers can spot the version bump and re-generate.
3. Multiple versions can coexist if we're testing migrations.

## Regenerating fixtures

When drizzle-kit is bumped:

1. Run the relevant integration test with `--update-snapshots`.
2. Manually inspect the diff. Confirm drizzle-kit's output shape
   change, if any, is expected.
3. Commit the new fixture file. Delete the old one once tests pass
   on the new version.

## Scenarios

- `add-field` — add a single column to an existing collection.
- `drop-field` — remove a column. Triggers destructive-change confirm path.
- `rename-field` — RenameDetector should classify as rename, not drop+add.
- `type-change` — change a column's type. Triggers coercion warning path.
- `multi-rename` — rename two columns in one apply. Tests heuristic robustness.
