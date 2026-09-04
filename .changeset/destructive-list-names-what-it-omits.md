---
"nextly": patch
---

When a schema change needs a terminal it cannot get, the error listing what you
would have been asked to approve no longer stops at three items without saying
so. It now names how many more there are, and how many of the omitted ones are
column drops — the only kind that loses data. Previously a run with 57 events
listed three and gave no sign that 17 of the 18 column drops were among the
ones it did not show.
