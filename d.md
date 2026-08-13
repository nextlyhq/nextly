Confirmed. Counting on the way OUT is what made the earlier guarantee false: the
total stays at 1 for as long as the root is being processed, so each slot's
length was compared against the cap on its own and every one of them passed.

Fixed by counting at ENQUEUE against one running total, which also lets the two
checks become one. Every entry pushed becomes a node or is refused as not being
one, so the enqueued count is the quantity the cap is about — the pop-side
counter was a second implementation of the same question and it is gone rather
than corrected.

Worth naming plainly: **this is the sixth site of one class in this file.** The
value walk, nested arrays, the root forest, the subtree walk, a slot's child
list, and now this. Every list copied before being read is bounded by what the
CALLER declared, and each round has closed one site while the next stayed open.
Round 18's fix and this one are the same three lines in two different walks.

I do not think a seventh patch is the right answer, and the design doc on this
branch now argues that in as many words: a parse-with-a-budget that descends
through ONE bounded reader has no next site to miss, where a hand-written check
per call site has an unbounded number of them. That is a follow-up PR, not this
one.

Test asserts the REASON rather than exhaustion — 40 slots of 40 against a
50-node cap, cheap and deterministic. Degrading the running total to a per-list
bound makes it fail: the subtree walk accepts the insert and the refusal comes
from the downstream cap check instead of from the lengths.
