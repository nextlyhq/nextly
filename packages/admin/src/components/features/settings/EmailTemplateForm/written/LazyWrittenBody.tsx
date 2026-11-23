"use client";

/**
 * The body of a written email, loaded when a workbench first shows one.
 *
 * A written email's editor brings Lexical and the drag-and-drop kit, which a
 * coded email and the rest of the admin never need: loaded here on demand,
 * none of it is part of the email screens' own code. While it loads, a box of
 * the body's size holds its place, so nothing moves when it arrives.
 *
 * @module components/features/settings/EmailTemplateForm/written/LazyWrittenBody
 */
import { Suspense, lazy, type JSX } from "react";

import type { WrittenBodyProps } from "./WrittenBody";

const WrittenBody = lazy(() =>
  import("./WrittenBody").then(module => ({ default: module.WrittenBody }))
);

export function LazyWrittenBody(props: WrittenBodyProps): JSX.Element {
  return (
    <Suspense
      fallback={
        <div
          aria-hidden
          className="min-h-95 w-full flex-1 animate-pulse bg-muted/30"
        />
      }
    >
      <WrittenBody {...props} />
    </Suspense>
  );
}
