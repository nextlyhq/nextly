---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Prune the activity and auth trails on a schedule.

**This deletes data the first time it runs.** Set the windows before you deploy
if you need longer ones.

Neither trail has ever actually been pruned. `activity_log` has claimed a 90-day
policy in its own schema comment since it was introduced, but the cleanup that
comment named was never called from anywhere — and could not have worked if it
had been, because it referenced a column that does not resolve and its failure
would have been swallowed. Installs are therefore carrying every row ever
written, while the schema said otherwise. `audit_log` never promised anything
and grew unbounded too.

Both are pruned now, and the first pass removes everything already past its
window:

- `activity_log` — content activity, who changed what — **90 days**
- `audit_log` — sign-ins, password changes, role grants — **180 days**

90 for content activity is what the comparable self-hosted CMSes default to, and
180 for auth events is what GitHub and Atlassian Cloud retain: security
questions are asked later than editorial ones, because a compromise is usually
noticed well after the sign-in that caused it.

To keep more, configure it **before** upgrading:

```ts
export default defineConfig({
  audit: {
    retention: {
      activityMaxAgeMs: 365 * 24 * 60 * 60 * 1000,
      authMaxAgeMs: false, // keep auth history forever
    },
  },
});
```

Each window is independent, so bounding the high-volume feed while keeping
security history indefinitely is one setting rather than a compromise.
`audit: { retention: false }` keeps everything, as today.

Passes run opportunistically off content writes, at most one per interval,
batched, and never fail the write that offered them. Batching matters on the
first run in particular: an install that has never pruned faces every row it has
ever written, and an unbounded `DELETE` there would take a long lock on the
largest table at the worst possible moment.

Scheduling is now shared rather than duplicated. The gate, interval and
never-throw wrapper that webhook retention already used are a general mechanism,
so audit retention registers a pass with it instead of introducing a second one.
Each pass is gated on its own key: a single shared marker would let whichever
pass ran first consume the interval for the others, and the busier domain would
starve the rest indefinitely.
