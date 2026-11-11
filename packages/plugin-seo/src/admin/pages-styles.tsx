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
.nx-seo-card-help{margin-top:8px}
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
.nx-seo-seg button[aria-selected="true"]{background:var(--nx-card);color:var(--nx-foreground);font-weight:600;box-shadow:0 1px 2px var(--nx-shadow-color)}
.nx-seo-drawer{position:fixed;top:var(--nx-seo-drawer-top,48px);right:0;bottom:0;width:480px;max-width:100vw;background:var(--nx-background);border-left:1px solid var(--nx-border);box-shadow:0 8px 24px var(--nx-shadow-color);overflow:auto;z-index:40;display:flex;flex-direction:column}
.nx-seo-dh{position:sticky;top:0;background:var(--nx-background);padding:14px 18px;border-bottom:1px solid var(--nx-border);display:flex;justify-content:space-between;align-items:flex-start;gap:10px;z-index:2}
.nx-seo-dh h2{margin:0;font-size:15px;font-weight:650;overflow-wrap:anywhere}
.nx-seo-dh .nx-seo-help span{font-family:var(--seo-mono);font-size:12px}
.nx-seo-db{padding:16px 18px;display:grid;gap:16px}
.nx-seo-df{position:sticky;bottom:0;background:var(--nx-background);border-top:1px solid var(--nx-border);padding:12px 18px;display:flex;justify-content:flex-end;gap:6px;margin-top:auto;z-index:2}
.nx-seo-dnote{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:8px;border:1px solid var(--nx-border);background:var(--nx-muted);font-size:13px;line-height:1.45}
.nx-seo-dnote > svg{margin-top:1px;color:var(--nx-muted-foreground);flex:none}
.nx-seo-dnote .t{flex:1;min-width:0}
.nx-seo-dnote b{font-weight:600}
.nx-seo-dnote.warn{background:var(--nx-warning-surface);border-color:var(--nx-warning-border)}
.nx-seo-dnote.warn > svg{color:var(--nx-warning-text)}
.nx-seo-dnote.ok{background:var(--nx-success-surface);border-color:var(--nx-success-border)}
.nx-seo-dnote.ok > svg{color:var(--nx-success-text)}
.nx-seo-dnote .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.nx-seo-dnote code,.nx-seo-src code{font-family:var(--seo-mono);font-size:12px;background:var(--nx-muted);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
.nx-seo-pv{border:1px solid var(--nx-border);border-radius:10px;background:var(--nx-card)}
.nx-seo-pv-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px 8px 14px;border-bottom:1px solid var(--nx-border-subtle);flex-wrap:wrap}
.nx-seo-pv-head .lbl{font-size:12px;font-weight:600;color:var(--nx-muted-foreground)}
.nx-seo-pv-body{padding:18px 20px 20px}
.nx-seo-serp{max-width:600px;font-family:Arial,sans-serif}
.nx-seo-serp .site{display:flex;align-items:center;gap:10px}
.nx-seo-serp .fav{width:26px;height:26px;border-radius:999px;background:var(--nx-muted);border:1px solid var(--nx-border);display:grid;place-items:center;font-size:11px;font-weight:700;flex:none}
.nx-seo-serp .sname{font-size:14px;color:var(--nx-foreground);line-height:1.2}
.nx-seo-serp .surl{font-size:12px;color:var(--nx-muted-foreground);line-height:1.3;overflow-wrap:anywhere}
.nx-seo-serp .stitle{color:var(--nx-info-text);font-size:20px;line-height:1.3;margin:7px 0 3px;overflow-wrap:anywhere}
.nx-seo-serp .sdesc{color:var(--nx-muted-foreground);font-size:14px;line-height:1.58;overflow-wrap:anywhere}
.nx-seo-pv-hidden{position:relative}
.nx-seo-pv-hidden .nx-seo-serp{opacity:.35}
.nx-seo-pv-hidden .over{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.nx-seo-pv-hidden .over span{background:var(--nx-card);border:1px solid var(--nx-border);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;box-shadow:0 8px 24px var(--nx-shadow-color)}
.nx-seo-card{border:1px solid var(--nx-border);border-radius:8px;overflow:hidden;background:var(--nx-card)}
.nx-seo-card .img{aspect-ratio:1.91/1;position:relative;overflow:hidden;background:var(--nx-muted);container-type:inline-size}
.nx-seo-card .img img{width:100%;height:100%;object-fit:cover;display:block}
.nx-seo-card .art{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;padding:7% 8%;background:var(--nx-foreground);color:var(--nx-background)}
.nx-seo-card .art small{font-size:2.3cqw;letter-spacing:.06em;text-transform:uppercase;opacity:.75}
.nx-seo-card .art strong{font-size:6cqw;line-height:1.1;letter-spacing:-.02em}
.nx-seo-card .meta{padding:10px 12px;background:var(--nx-muted);border-top:1px solid var(--nx-border-subtle)}
.nx-seo-card .dom{font-size:12px;color:var(--nx-muted-foreground);text-transform:lowercase}
.nx-seo-card .ct{font-size:15px;font-weight:600;margin-top:2px;line-height:1.3;overflow-wrap:anywhere}
.nx-seo-card .cd{font-size:13px;color:var(--nx-muted-foreground);margin-top:2px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nx-seo-sf{display:grid;gap:6px}
.nx-seo-sf-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.nx-seo-sf-head label{font-weight:600;font-size:13px}
.nx-seo-inp{min-height:38px;border:1px solid var(--nx-border);border-radius:8px;padding:8px 11px;background:var(--nx-card);color:var(--nx-foreground);width:100%;resize:vertical;line-height:1.45;font:inherit;font-size:14px}
.nx-seo-inp::placeholder{color:var(--nx-muted-foreground);opacity:1}
.nx-seo-inp:focus{outline:2px solid var(--nx-ring);outline-offset:-1px;border-color:transparent}
.nx-seo-src{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--nx-muted-foreground);line-height:1.5}
.nx-seo-chip{font-size:11px;font-weight:600;padding:1px 7px;border-radius:5px;background:var(--nx-muted);color:var(--nx-foreground);white-space:nowrap}
.nx-seo-chip.typed{background:var(--nx-foreground);color:var(--nx-background)}
.nx-seo-chip.code{background:transparent;border:1px dashed var(--nx-muted-foreground)}
.nx-seo-src .nx-seo-linkbtn{font-size:12px}
.nx-seo-adv{border:1px solid var(--nx-border);border-radius:10px;background:var(--nx-card)}
.nx-seo-adv-toggle{width:100%;display:flex;align-items:center;gap:10px;padding:12px 14px;border:0;background:transparent;cursor:pointer;text-align:left;border-radius:10px;font:inherit;color:inherit}
.nx-seo-adv-toggle:hover{background:var(--nx-accent)}
.nx-seo-adv-toggle b{font-size:14px;font-weight:600}
.nx-seo-adv-toggle .sum{color:var(--nx-muted-foreground);font-size:13px;flex:1;min-width:0}
.nx-seo-adv-toggle .chev{transition:transform .15s;color:var(--nx-muted-foreground);display:inline-flex}
.nx-seo-adv-toggle[aria-expanded="true"] .chev{transform:rotate(180deg)}
.nx-seo-arow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;padding:14px;border-top:1px solid var(--nx-border-subtle);align-items:start}
.nx-seo-arow .full{grid-column:1/-1;display:grid;gap:8px}
.nx-seo-arow .lab{font-weight:600;font-size:13px}
.nx-seo-arow .nx-seo-help{margin-top:2px}
.nx-seo-arow .mono{font-family:var(--seo-mono);font-size:12px;color:var(--nx-foreground);overflow-wrap:anywhere}
.nx-seo-sw{position:relative;width:34px;height:20px;border-radius:999px;border:0;background:var(--nx-muted-foreground);opacity:.55;cursor:pointer;flex:none;padding:0}
.nx-seo-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;background:var(--nx-background);box-shadow:0 1px 2px var(--nx-shadow-color);transition:left .15s}
.nx-seo-sw[aria-checked="true"]{background:var(--nx-primary);opacity:1}
.nx-seo-sw[aria-checked="true"]::after{left:16px;background:var(--nx-primary-foreground)}
@media (prefers-reduced-motion:reduce){.nx-seo-sw::after,.nx-seo-adv-toggle .chev{transition:none}}
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
.nx-seo-pv-body{padding:14px}
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

/** A chevron that turns when what it opens is open. */
export function Chevron(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
