/**
 * The SEO settings screen's own styles, scoped to its root (`.nx-seo`) and
 * drawn only from the admin's `--nx-*` tokens, so they follow the admin's
 * light and dark modes and reach nothing outside the screen.
 *
 * Shipped beside the components rather than as a stylesheet a site must
 * import: the admin compiles utilities from its own sources and a short
 * plugin list, and the screen's tabs, pattern chips and choice cards need
 * rules of their own. React places the one `<style>` in the document's head
 * and keeps a single copy however many parts render it.
 *
 * @module admin/styles
 */
import type { JSX } from "react";

/** The class every part of the screen sits under, the dialog included. */
export const ROOT = "nx-seo";

const CSS = `
.nx-seo{--seo-mono:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--nx-foreground);font-size:14px;line-height:1.45}
.nx-seo *{box-sizing:border-box}
.nx-seo :focus-visible{outline:2px solid var(--nx-ring);outline-offset:2px}
.nx-seo-page{min-width:0}
.nx-seo-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px 16px;padding:22px 24px 0;flex-wrap:wrap}
.nx-seo-head h1{margin:0;font-size:22px;font-weight:700;letter-spacing:-.01em}
.nx-seo-head p{margin:4px 0 0;color:var(--nx-muted-foreground);font-size:13px;max-width:80ch}
.nx-seo-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.nx-seo-tabs{display:flex;gap:2px;padding:0 24px;border-bottom:1px solid var(--nx-border);margin-top:14px;overflow-x:auto;scrollbar-width:thin}
.nx-seo-tab{flex:none;border:0;background:transparent;padding:9px 12px;font:inherit;font-size:13px;font-weight:500;color:var(--nx-muted-foreground);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
.nx-seo-tab:hover{color:var(--nx-foreground)}
.nx-seo-tab[aria-selected="true"]{color:var(--nx-foreground);border-bottom-color:var(--nx-foreground);font-weight:600}
.nx-seo-cnt{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--nx-warning-surface);color:var(--nx-warning-text);border:1px solid var(--nx-warning-border);font-size:12px;font-weight:600;display:inline-grid;place-items:center;line-height:1}
.nx-seo-body{padding:20px 24px 32px}
.nx-seo-lead{margin:0 0 16px;color:var(--nx-muted-foreground);font-size:13px}
.nx-seo-form2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 20px;max-width:880px}
.nx-seo-form2 .nx-seo-wide{grid-column:1/-1}
.nx-seo-field{display:grid;gap:6px;align-content:start;min-width:0}
.nx-seo-label{font-weight:600;font-size:13px}
.nx-seo-help{margin:0;font-size:13px;color:var(--nx-muted-foreground);line-height:1.45}
.nx-seo-help b{color:var(--nx-foreground);font-weight:600}
.nx-seo-error{margin:0;font-size:13px;color:var(--nx-danger-text);font-weight:500}
.nx-seo-mono{font-family:var(--seo-mono)!important;font-size:13px!important}
.nx-seo-seg{display:inline-flex;flex-wrap:wrap;padding:3px;border-radius:9px;background:var(--nx-muted);gap:2px;width:max-content}
.nx-seo-seg button{border:0;background:transparent;min-width:36px;padding:5px 10px;border-radius:7px;font:inherit;font-size:14px;font-weight:500;color:var(--nx-muted-foreground);cursor:pointer}
.nx-seo-seg button[aria-pressed="true"]{background:var(--nx-card);color:var(--nx-foreground);font-weight:600;box-shadow:0 1px 2px var(--nx-shadow-color)}
.nx-seo-upl{display:flex;align-items:center;gap:12px;padding:10px;border:1px dashed var(--nx-border);border-radius:8px;background:var(--nx-card);min-width:0}
.nx-seo-upl-text{flex:1;min-width:0;font-size:13px}
.nx-seo-upl-text > span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nx-seo-thumb{width:56px;height:40px;border-radius:6px;background:var(--nx-muted);border:1px solid var(--nx-border);display:grid;place-items:center;color:var(--nx-muted-foreground);flex:none;overflow:hidden}
.nx-seo-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.nx-seo-thumb.square{width:40px;height:40px;border-radius:9px}
.nx-seo-thumb.square img{object-fit:contain}
.nx-seo-upl-acts{display:flex;gap:6px;flex:none}
.nx-seo-addrs{display:grid;gap:6px}
.nx-seo-profiles{max-width:620px}
.nx-seo-stack{display:grid;gap:18px;max-width:720px}
.nx-seo-addr{display:flex;gap:6px;align-items:center}
.nx-seo-addr > :first-child{flex:1;min-width:0}
.nx-seo-linkbtn{border:0;background:none;padding:0;color:var(--nx-foreground);text-decoration:underline;text-underline-offset:2px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;justify-self:start}
.nx-seo-linkbtn:hover{text-decoration-thickness:2px}
.nx-seo-tbox{border:1px solid var(--nx-border);border-radius:10px;overflow:hidden;background:var(--nx-card)}
.nx-seo-tbl{width:100%;border-collapse:collapse}
.nx-seo-tbl th{padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--nx-muted-foreground);border-bottom:1px solid var(--nx-border);background:var(--nx-table-header-bg);white-space:nowrap}
.nx-seo-tbl td{padding:10px 12px;border-bottom:1px solid var(--nx-border-subtle);vertical-align:top;font-size:13px}
.nx-seo-tbl tr:last-child td{border-bottom:0}
.nx-seo-tname b{font-weight:600;display:block}
.nx-seo-tname small{display:block;color:var(--nx-muted-foreground);font-size:12px}
.nx-seo-code{font-family:var(--seo-mono);font-size:12px;background:var(--nx-muted);padding:2px 6px;border-radius:4px;overflow-wrap:anywhere}
.nx-seo-notpublic{color:var(--nx-warning-text);font-weight:600;display:inline-flex;gap:6px;align-items:center}
.nx-seo-pattern{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--nx-border);border-radius:7px;padding:4px 8px;background:var(--nx-background);color:var(--nx-foreground);cursor:pointer;font-family:var(--seo-mono);font-size:12px;max-width:100%;text-align:left;overflow-wrap:anywhere}
.nx-seo-pattern:hover{border-color:var(--nx-muted-foreground)}
.nx-seo-pattern[aria-expanded="true"]{border-color:var(--nx-foreground)}
.nx-seo-pattern small{font-family:inherit;font-size:12px;color:var(--nx-muted-foreground)}
.nx-seo-editrow td{background:var(--nx-muted)}
.nx-seo-pedit{display:grid;gap:10px;max-width:760px}
.nx-seo-vars{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.nx-seo-var{border:1px solid var(--nx-border);background:var(--nx-card);color:var(--nx-foreground);border-radius:6px;padding:3px 8px;font-family:var(--seo-mono);font-size:12px;cursor:pointer}
.nx-seo-var:hover{background:var(--nx-accent)}
.nx-seo-ex{font-size:13px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}
.nx-seo-ex b{font-weight:600;overflow-wrap:anywhere}
.nx-seo-count{font-size:12px;color:var(--nx-muted-foreground);font-variant-numeric:tabular-nums;white-space:nowrap}
.nx-seo-count.over{color:var(--nx-warning-text);font-weight:600}
.nx-seo-row{display:flex;gap:6px;flex-wrap:wrap}
.nx-seo-note{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:8px;border:1px solid var(--nx-border);background:var(--nx-muted);font-size:13px;max-width:720px}
.nx-seo-note > svg{margin-top:2px;color:var(--nx-muted-foreground);flex:none}
.nx-seo-note b{font-weight:600}
.nx-seo-lock{display:flex;gap:8px;align-items:flex-start;margin-top:10px}
.nx-seo-lock > svg{margin-top:2px;flex:none;color:var(--nx-muted-foreground)}
.nx-seo-rgroup{display:grid;gap:6px}
.nx-seo-rgroup.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.nx-seo-radio{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--nx-border);border-radius:8px;background:var(--nx-card);cursor:pointer}
.nx-seo-radio:hover{background:var(--nx-accent)}
.nx-seo-radio:has(input:checked){border-color:var(--nx-foreground)}
.nx-seo-radio:has(input:focus-visible){outline:2px solid var(--nx-ring);outline-offset:2px}
.nx-seo-radio input{margin:3px 0 0;accent-color:var(--nx-primary);flex:none}
.nx-seo-radio b{font-weight:600;font-size:13px;display:block}
.nx-seo-radio span span{display:block;font-size:13px;color:var(--nx-muted-foreground);margin-top:2px}
.nx-seo-profile{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:8px;align-items:center}
.nx-seo-net{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nx-seo-net.empty{color:var(--nx-muted-foreground);font-weight:500}
.nx-seo-banner{display:flex;align-items:center;gap:12px;padding:10px 24px;border-bottom:1px solid var(--nx-warning-border);background:var(--nx-warning-surface);color:var(--nx-foreground);font-size:13px;flex-wrap:wrap}
.nx-seo-banner > span{flex:1;min-width:200px}
.nx-seo-banner b{font-weight:600}
.nx-seo-alert{margin:12px 24px 0;padding:10px 12px;border-radius:8px;border:1px solid var(--nx-danger-border);background:var(--nx-danger-surface);color:var(--nx-danger-text);font-size:13px}
.nx-seo-state{padding:40px 24px;color:var(--nx-muted-foreground);font-size:13px}
.nx-seo-dialog{gap:0!important;padding:0!important;overflow:hidden;display:flex!important;flex-direction:column;max-height:calc(100dvh - 32px)}
.nx-seo-dlg-head{padding:18px 48px 0 20px}
.nx-seo-dlg-head h2{margin:0;font-size:18px;font-weight:700;letter-spacing:-.01em}
.nx-seo-dlg-head p{margin:4px 0 0;color:var(--nx-muted-foreground);font-size:13px}
.nx-seo-steps{display:flex;gap:6px;padding:14px 20px 0}
.nx-seo-steps span{flex:1;height:4px;border-radius:999px;background:var(--nx-muted)}
.nx-seo-steps span.on{background:var(--nx-foreground)}
.nx-seo-dlg-body{padding:16px 20px;display:grid;gap:16px;overflow:auto}
.nx-seo-dlg-foot{padding:14px 20px;border-top:1px solid var(--nx-border-subtle);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.nx-seo-minilist{display:grid;border:1px solid var(--nx-border);border-radius:10px;overflow:hidden;background:var(--nx-card)}
.nx-seo-minilist > div{display:flex;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid var(--nx-border-subtle);font-size:13px}
.nx-seo-minilist > div:first-child{border-top:0}
.nx-seo-minilist .grow{flex:1;min-width:0}
.nx-seo-warnc{color:var(--nx-warning-text);display:inline-flex;flex:none}
.nx-seo-okc{color:var(--nx-success-text);display:inline-flex;flex:none}
@media (max-width:720px){
.nx-seo-head{padding:18px 16px 0}
.nx-seo-tabs{padding:0 16px}
.nx-seo-body{padding:16px 16px 28px}
.nx-seo-banner{padding:10px 16px}
.nx-seo-alert{margin:12px 16px 0}
.nx-seo-form2{grid-template-columns:minmax(0,1fr)}
.nx-seo-rgroup.two{grid-template-columns:minmax(0,1fr)}
.nx-seo-types thead{display:none}
.nx-seo-types tr{display:grid;gap:6px;padding:12px;border-bottom:1px solid var(--nx-border-subtle)}
.nx-seo-types tr:last-child{border-bottom:0}
.nx-seo-types td{display:block;padding:0;border:0}
.nx-seo-types td[data-label]::before{content:attr(data-label);display:block;font-size:12px;font-weight:600;color:var(--nx-muted-foreground);margin-bottom:2px}
.nx-seo-profile{grid-template-columns:minmax(0,1fr) auto}
.nx-seo-profile .nx-seo-net{grid-column:1/-1}
.nx-seo-dialog{width:calc(100% - 32px)!important}
}
`;

/** The screen's styles, placed once in the document's head. */
export function SeoStyles(): JSX.Element {
  return (
    <style href="nextly-plugin-seo-settings" precedence="default">
      {CSS}
    </style>
  );
}

/** The icons the screen draws. */
export type IconName =
  | "warn"
  | "image"
  | "plus"
  | "x"
  | "info"
  | "lock"
  | "check"
  | "arrow";

const PATHS: Record<IconName, JSX.Element> = {
  warn: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};

/** One of the screen's icons, in the text colour around it. */
export function Icon({ name }: { name: IconName }): JSX.Element {
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
      {PATHS[name]}
    </svg>
  );
}
