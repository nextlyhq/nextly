# @nextlyhq/module-specifiers

One AST reader for the module specifiers a source file loads. Private, consumed
only by layering guards inside this repository, never published and never
bundled into anything shipped.

```ts
import {
  importedSpecifiers,
  UNRESOLVABLE_SPECIFIER,
} from "@nextlyhq/module-specifiers";

importedSpecifiers(readFileSync(file, "utf8"), file);
```

## Why this exists

Several packages each need the same answer — which packages does this file reach
— and each had grown its own reader. They agreed the day they were written and
had already drifted. `.claude/rules/derived-checks.md` states the rule: a
narrower view must be DERIVED from the richer one, never computed alongside it.

## Scope: the IMPORT boundary, not reachability

This answers **which specifiers a SOURCE file loads**. That is the right level
for a layering rule, which is a statement about what an author may write.

It is **not** the answer to "what does this entry point actually reach". A
bundler can inline a dependency, and the specifier then exists nowhere in the
output — no source reader can see an import that no longer exists. That question
is answered by reading the built artifact and the bundler's metafile, which
`packages/ui/scripts/check-server-safe-artifacts.ts` does deliberately
separately. Do not merge the two: they take different inputs and answer
different questions, and neither subsumes the other.

## Two things callers get wrong

**`fileName` is required, and is not diagnostic.** TypeScript picks its parser
from the extension. Reading a `.tsx` file under a `.ts` name parses `<div>` as a
type assertion; the recovered tree contains no import nodes, so the file reports
as importing nothing. That is a clean green over a file that was never read, and
it was a live defect in two of the readers this replaces.

**`UNRESOLVABLE_SPECIFIER` is a finding, not an absence.** A target that is not a
literal — `import(base + name)` — cannot be resolved by reading the file, so the
honest report is "unknown", and unknown has to be a violation. A caller that
filters it out has built a guard that approves whatever it could not read. It is
deliberately not a legal package specifier, so no allowlist entry can satisfy it.

## Why it exports TypeScript source

`exports` points at `./src/index.ts` rather than a build output, which is
Turborepo's just-in-time shape for an internal package. It is load-bearing for
the one control that proves the consumers are wired to it: **break this reader
and every consuming suite must go red.** Were this to emit a `dist`, consumers
would resolve the built output, breaking the source would leave them green
against stale artifacts, and that green reads as "this consumer is not wired up"
— the exact opposite of the truth.

## The corpus lives here on purpose

`src/index.test.ts` holds one case per import form the reader claims, and the
forms it must not claim. A reader that quietly stops recognising a form returns a
clean result to every consumer at once, while each consumer's own suite reports
the green it always did. The corpus that catches that belongs beside the reader.

Note this is a different control from "the input set is non-empty". A guard can
read every file it was given and still be unable to fail on any input. Only a
known offender it must REJECT catches that.
