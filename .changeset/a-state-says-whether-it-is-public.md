---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A content state now declares whether it is public, and the read path asks.

Nothing an author sees changes. The vocabulary is still `draft` and `published`,
the default workflow declares exactly those two, and every read returns what it
returned before — which is the point of doing it this way round.

What changes is where the answer comes from. The auto-filter that decides what
an untrusted caller may see no longer compares against the literal `"published"`;
it asks the workflow which of its states are public. Admitting a third state
later is then a change to one file rather than to every reader.

A state the workflow does not declare answers NOT public. A row can carry a
state a later edit removed, and the only safe reading of "nobody has decided
about this" is that it is not published — absence of a decision is not
permission.

The release-aware read paths ask the same question. A due release publishes into
whatever state the workflow calls public, so the four places that recognised the
word `published` — the SQL condition, both collection read paths and Singles —
now ask whether the state IS public. Under the default workflow they take exactly
the branch they took before; under a workflow that renames its public state they
keep revealing scheduled publications and keep applying scheduled withdrawals,
where a literal would have skipped both and shown a query that returns rows and
looks like it worked.

The single-public-state assertion is deliberate. A workflow with two public
states needs a set predicate rather than an equality, which the SQL builder does
not construct yet, so this refuses rather than silently dropping rows from every
public read.
