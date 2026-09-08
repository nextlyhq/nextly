/**
 * The splitter's name is a TYPE requirement, and only the checker can say so.
 *
 * A runtime test can assert that a name which was supplied arrives on the
 * element. It cannot assert the interesting half — that a call site omitting
 * the name does not compile — because such a call site never runs. So the
 * contract lives here, where `check-types` evaluates it.
 *
 * Written with `expectTypeOf` rather than `@ts-expect-error`. That directive
 * suppresses ANY error on the line beneath it, so it keeps passing when the
 * line starts failing for an unrelated reason and keeps passing after the
 * rejection it was written for stops happening. These assertions are evaluated
 * by the checker and name the property they are about.
 *
 * @module resizable.test-d
 */
import type * as React from "react";
import { expectTypeOf } from "vitest";

import type { ResizableHandle } from "./resizable";

type HandleProps = React.ComponentProps<typeof ResizableHandle>;

// Either form of name satisfies it. Both are asserted rather than one, because
// a caller labelling by reference to visible text is as correct as one
// spelling the name out, and a contract accepting only the first would push
// call sites into duplicating a string that already exists on the page.
expectTypeOf<{ "aria-label": string }>().toMatchTypeOf<HandleProps>();
expectTypeOf<{ "aria-labelledby": string }>().toMatchTypeOf<HandleProps>();

// The whole point: no name, no handle. Without this the two assertions above
// pass against a component that requires nothing at all.
expectTypeOf<{ withGrip: true }>().not.toMatchTypeOf<HandleProps>();
expectTypeOf<Record<string, never>>().not.toMatchTypeOf<HandleProps>();

// Two names on one element is an ambiguity resolved by precedence rules the
// author is not thinking about, so it is refused rather than silently ranked.
expectTypeOf<{
  "aria-label": string;
  "aria-labelledby": string;
}>().not.toMatchTypeOf<HandleProps>();
