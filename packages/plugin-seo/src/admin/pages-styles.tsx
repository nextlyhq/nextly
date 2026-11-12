/**
 * The Pages and addresses screen's own styles, under the plugin's root
 * class (`.nx-seo`) and drawn only from the admin's `--nx-*` tokens, so they
 * follow its light and dark modes and reach nothing outside the screen.
 *
 * @module admin/pages-styles
 */
import type { JSX } from "react";

const CSS = `
.nx-seo-sum{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.nx-seo-sum span{font-size:13px;border:1px solid var(--nx-border);border-radius:999px;padding:3px 10px;background:var(--nx-card);color:var(--nx-muted-foreground)}
.nx-seo-sum b{color:var(--nx-foreground);font-weight:600}
.nx-seo-sum .warn{border-color:var(--nx-warning-border);background:var(--nx-warning-surface);color:var(--nx-warning-text);font-weight:600}
.nx-seo-sum .warn b{color:inherit}
.nx-seo-find{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.nx-seo-find input[type="search"]{width:260px;max-width:100%;height:32px;min-height:32px;padding:4px 10px;border:1px solid var(--nx-border);border-radius:8px;background:var(--nx-card);color:var(--nx-foreground);font:inherit;font-size:14px}
.nx-seo-find input[type="search"]::placeholder{color:var(--nx-muted-foreground);opacity:1}
.nx-seo-find input[type="search"]:focus{outline:2px solid var(--nx-ring);outline-offset:-1px;border-color:transparent}
.nx-seo-tscroll{overflow-x:auto}
.nx-seo-atbl{min-width:0}
.nx-seo-atbl .w-addr{width:24%}
.nx-seo-atbl .w-src{width:22%}
.nx-seo-atbl .w-search{width:130px}
.nx-seo-atbl .w-act{width:110px}
.nx-seo-atbl td{vertical-align:middle}
.nx-seo-atbl tr.on td{background:var(--nx-accent)}
.nx-seo-addr-cell b{font-family:var(--seo-mono);font-size:13px;font-weight:500;display:block;overflow-wrap:anywhere}
.nx-seo-addr-cell span{font-size:12px;color:var(--nx-muted-foreground)}
.nx-seo-srcl{font-size:13px}
.nx-seo-srcl span{display:block;font-family:var(--seo-mono);color:var(--nx-muted-foreground);font-size:12px;overflow-wrap:anywhere}
.nx-seo-pill{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--nx-muted);color:var(--nx-foreground);white-space:nowrap}
.nx-seo-pill.t{background:transparent;border:1px dashed var(--nx-muted-foreground)}
.nx-seo-pill.nc{background:var(--nx-warning-surface);color:var(--nx-warning-text);border:1px solid var(--nx-warning-border)}
.nx-seo-act{text-align:right}
.nx-seo-empty{padding:28px;text-align:center}
.nx-seo-empty b{font-weight:600}
.nx-seo-shifted{padding-right:480px}
.nx-seo-shifted .nx-seo-atbl{min-width:720px}
.nx-seo-drawer{position:fixed;top:var(--nx-seo-drawer-top,48px);right:0;bottom:0;width:480px;max-width:100vw;background:var(--nx-background);border-left:1px solid var(--nx-border);box-shadow:0 8px 24px var(--nx-shadow-color);overflow:auto;z-index:40;display:flex;flex-direction:column}
.nx-seo-dh{position:sticky;top:0;background:var(--nx-background);padding:14px 18px;border-bottom:1px solid var(--nx-border);display:flex;justify-content:space-between;align-items:flex-start;gap:10px;z-index:2}
.nx-seo-dh h2{margin:0;font-size:15px;font-weight:650;overflow-wrap:anywhere}
.nx-seo-dh .nx-seo-help span{font-family:var(--seo-mono);font-size:12px}
.nx-seo-db{padding:16px 18px;display:grid;gap:16px}
.nx-seo-fields{border:0;padding:0;margin:0;min-width:0;display:grid;gap:16px}
.nx-seo-df{position:sticky;bottom:0;background:var(--nx-background);border-top:1px solid var(--nx-border);padding:12px 18px;display:flex;justify-content:flex-end;gap:6px;margin-top:auto;z-index:2}
@media (max-width:1100px){.nx-seo-shifted{padding-right:0}}
@media (max-width:720px){
.nx-seo-find input[type="search"]{width:100%}
.nx-seo-atbl thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.nx-seo-atbl tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;padding:12px;border-bottom:1px solid var(--nx-border-subtle)}
.nx-seo-atbl tr:last-child{border-bottom:0}
.nx-seo-atbl td{display:block;padding:0;border:0}
.nx-seo-atbl td.nx-seo-addr-cell,.nx-seo-atbl td.nx-seo-title,.nx-seo-atbl td.nx-seo-srcl{grid-column:1/-1}
.nx-seo-atbl td.nx-seo-act{text-align:right}
.nx-seo-drawer{width:100vw;top:0;z-index:60;border-left:0}
.nx-seo-db{padding:16px}
}
`;

/** The screen's styles, placed once in the document's head. */
export function PagesStyles(): JSX.Element {
  return (
    <style href="nextly-plugin-seo-pages" precedence="default">
      {CSS}
    </style>
  );
}
