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
.nx-seo-conn .nx-seo-connok,.nx-seo-conn .nx-seo-connfail{margin-top:6px}
.nx-seo-conn .nx-seo-connok{color:var(--nx-success-text)}
.nx-seo-connok .nx-seo-okc,.nx-seo-connfail .nx-seo-warnc{vertical-align:-3px}
.nx-seo-connmore{grid-column:1/-1;border-top:1px solid var(--nx-border);margin-top:10px;padding-top:12px}
.nx-seo-gsc{display:grid;gap:12px}
.nx-seo-gsc .nx-seo-label{display:block;margin-bottom:4px}
.nx-seo-gsclist{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.nx-seo-gsclist li{display:flex;justify-content:space-between;gap:12px;font-size:13px;min-width:0}
.nx-seo-gsclist li > span:first-child{overflow-wrap:anywhere;min-width:0}
.nx-seo-gsclist li .nx-seo-help{flex:none;margin:0}
.nx-seo-gsc .nx-seo-mono{font-family:var(--seo-mono);font-size:12px}
`;

/** The tab's styles, placed once in the document's head by React. */
export function ConnectionStyles(): JSX.Element {
  return (
    <style href="nextly-plugin-seo-connections" precedence="default">
      {CSS}
    </style>
  );
}
