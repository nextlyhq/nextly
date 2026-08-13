Confirmed, and it is the worse direction of the two: a non-finite limit does not
loosen the cap, it REMOVES it, and silently. The walk runs, the comparison
evaluates, and the answer is always "fits".

Verified your example rather than reasoning about it — with
`maxBytes: NaN`, `applyOp` accepts a 3 MB `customCss` and returns normally.
That is now the test, and removing the guard reproduces it exactly.

Refusing more than `NaN`, and each for its own reason:

- **`Infinity`** reads as "no limit" and is not one. The engine's walks stop at
  the machine bounds whatever a site says, so an infinite cap promises an
  unlimited document the module will not deliver.
- **fractional** refuses at a boundary no document can sit exactly on, so the
  message names a count no author can act on.
- **zero and negative** refuse every document including the empty one.

So the rule is `Number.isSafeInteger(value) && value >= 1` across all three
fields, checked at the top of `applyOp` before anything is judged against them.

On why the type did not cover it: `DocumentLimits` declares these as `number`,
which `NaN` and the infinities satisfy. A site reading a limit from
configuration, an environment variable or a JSON column produces one by parsing
a value that was not there, so the guard belongs at the boundary rather than in
the type.
