/**
 * The Connections tab's own styles, on top of the SEO screens' shared ones
 * (`styles`): one bordered row per service, its words beside its control.
 * Scoped to `.nx-seo` and drawn only from the admin's `--nx-*` tokens, so
 * light and dark follow.
 *
 * @module admin/connection-styles
 */
import type { JSX } from "react";

const CSS = `
.nx-seo-conns{max-width:760px}
.nx-seo-conn{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 20px;padding:16px;border:1px solid var(--nx-border);border-radius:10px;background:var(--nx-card);align-items:center}
.nx-seo-conn + .nx-seo-conn{margin-top:10px}
.nx-seo-conn b{font-size:14px;font-weight:600}
.nx-seo-conn .nx-seo-help{margin-top:2px}
`;

/** The tab's styles, placed once in the document's head by React. */
export function ConnectionStyles(): JSX.Element {
  return (
    <style href="nextly-plugin-seo-connections" precedence="default">
      {CSS}
    </style>
  );
}
