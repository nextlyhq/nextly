---
"nextly": patch
---

A collection schema save that runs its own migration file now keeps the push's checks: it refuses a unique field whose index name another index already holds, refuses a column no field describes (naming it, as the push does), and drops a leftover unique index on a column whose field stops being unique.
