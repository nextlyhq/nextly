---
"nextly": patch
"@nextlyhq/admin": patch
---

Name an entry the same way on every surface, and announce a refused schema
change only where the metadata actually moved.

Three spellings of "is this value a usable title" disagreed: one accepted a
whitespace-only string, one refused a number, and one refused a bigint. A
collection whose title field held an invoice number was named by it in the
editor and by its id on the page comparing its versions. There is now one rule,
`readableTitleText`, and the three callers ask it.

The dashboard's recent-entries projection also named fewer candidates than the
heading walk considers, so `label`, `subject` and `heading` were absent from
every real read and could never be reached. It now spreads from the same list
the walk reads.

The widget source refresh no longer announces a deferral on a reload that
carries only a refused change: that path skips the metadata sync by design, so
its registry still describes the unchanged table, and announcing one withheld
generated cards that were working.
