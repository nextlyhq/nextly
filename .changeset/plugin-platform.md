---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Extensible plugin platform — plugins are first-class, semver-protected extensions of a Nextly app, wired through a single `plugins` array in `defineConfig`.

- **Plugin contract + SDK**: `definePlugin()` and the `plugins` array, with `@nextlyhq/plugin-sdk` as the stable, semver-protected authoring boundary (the packages stay `0.x` alpha; the SDK surface is held to the stability ladder). Boot-time dependency ordering via `dependsOn` / `optionalDependsOn`, version-range checks, and an `enabled` gate.

- **Schema contributions**: plugins can contribute their own collections, singles, and components; `contributes.extend` adds fields to existing collections — both code-first AND UI-Builder–created ones — and cross-plugin relations resolve at boot. Plugin-owned fields carry provenance (`source`/`owner`/`locked`) and render locked + labelled in the Schema Builder so they can't be edited away.

- **Permissions**: `contributes.permissions` registers custom permissions and role bundles that flow through the existing access-control checks.

- **HTTP routes**: namespaced, secure-by-default plugin routes mounted under `/api/plugins/<name>/…`, with the same auth/CSRF guarantees as core routes.

- **Admin UI contributions**: menu items, full pages, settings panels, custom views, and header/toolbar slots (show/hide defaults + inject components). Plugin admin component modules are auto-registered.

- **Lifecycle events + filters**: an event bus plugins publish to and subscribe from, plus context filters they can transform — the basis for cache invalidation, side effects, and cross-plugin reactions.

- **Custom field types, email providers/templates, and auth extensibility** (strategies + hooks) are all pluggable through the same contract.

- **First-party + tooling**: ships `@nextlyhq/plugin-form-builder`, the `nextly add <package>` install-and-wire CLI command, and `create-nextly-app` plugin scaffolding.
