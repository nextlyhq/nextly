/**
 * The `text` archetype: prose the host draws from the declaration.
 *
 * Drawn from the DECLARATION, with no query behind it, the way `actions` is:
 * core's validator refuses a query on this archetype and requires the
 * `content`, so by the time a widget reaches the browser it carries non-blank
 * markdown and no slot will ever arrive for it.
 *
 * The renderer is loaded when the first text card is drawn, not with the
 * dashboard. It is Lexical -- the rich-text field's own stack -- and the field
 * loads it the same way for the same reason.
 *
 * @module components/features/widgets/archetypes/text
 */

import { lazy, Suspense } from "react";

import type { DeclaredBody } from "./types";

const TextMarkdown = lazy(() =>
  import("./TextMarkdown").then(mod => ({ default: mod.TextMarkdown }))
);

/**
 * NO `accepts`, for the same reason `actions` has none: the declaration is
 * refused where it is written if the content is missing or blank, so there is
 * nothing left to judge here that boot has not judged already.
 */
export const textBody: DeclaredBody = definition => {
  const content = definition.content ?? "";
  return {
    ok: true,
    node: (
      <Suspense
        fallback={
          <div
            data-testid="widget-text-loading"
            aria-busy="true"
            className="h-16 animate-pulse rounded-md bg-muted"
          />
        }
      >
        <TextMarkdown key={content} content={content} />
      </Suspense>
    ),
  };
};
