# Scratch

Developer scratchpad. Files here are for ad-hoc debugging during local
development — they are NOT meant to ship to production. Treat the
folder like `*.test.ts` files: useful at the bench, irrelevant in the
deployed app.

Examples of what belongs here:

- One-off scripts to inspect the DB shape (`debug-queries.ts`).
- Type-narrowing experiments while you build a new feature.
- Throwaway prompt mockups, sample payloads, etc.

Examples of what does NOT belong here:

- Anything imported by `src/app/`, `src/components/`, or any production
  code path. If a tool ends up being permanently useful, promote it
  out of `__scratch__/` to `src/lib/`.
- Production seed data (use `seed/seed-data.json` instead).
