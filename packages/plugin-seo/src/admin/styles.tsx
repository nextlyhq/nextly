/**
 * The styles the SEO screens not yet drawn from the admin's own parts still
 * use, scoped to their root (`.nx-seo`) and
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
/* The border in longhands, so the neutral .n count changes its colour alone. */
.nx-seo-cnt{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--nx-warning-surface);color:var(--nx-warning-text);border-width:1px;border-style:solid;border-color:var(--nx-warning-border);font-size:12px;font-weight:600;display:inline-grid;place-items:center;line-height:1}
.nx-seo-body{padding:20px 24px 32px}
.nx-seo-form2 .nx-seo-wide{grid-column:1/-1}
.nx-seo-field{display:grid;gap:6px;align-content:start;min-width:0}
.nx-seo-label{font-weight:600;font-size:13px}
.nx-seo-help{margin:0;font-size:13px;color:var(--nx-muted-foreground);line-height:1.45}
.nx-seo-help b{color:var(--nx-foreground);font-weight:600}
.nx-seo-error{margin:0;font-size:13px;color:var(--nx-danger-text);font-weight:500}
/* Under the root, so the face and size win over a table cell's or a control's own. */
.nx-seo .nx-seo-mono{font-family:var(--seo-mono);font-size:13px}
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
.nx-seo-addr{display:flex;gap:6px;align-items:center}
.nx-seo-addr > :first-child{flex:1;min-width:0}
.nx-seo-linkbtn{border:0;background:none;padding:0;color:var(--nx-foreground);text-decoration:underline;text-underline-offset:2px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;justify-self:start}
.nx-seo-linkbtn:hover{text-decoration-thickness:2px}
.nx-seo-tbox{border:1px solid var(--nx-border);border-radius:10px;overflow:hidden;background:var(--nx-card)}
.nx-seo-tbl{width:100%;border-collapse:collapse}
.nx-seo-tbl th{padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--nx-muted-foreground);border-bottom:1px solid var(--nx-border);background:var(--nx-table-header-bg);white-space:nowrap}
.nx-seo-tbl td{padding:10px 12px;border-bottom:1px solid var(--nx-border-subtle);vertical-align:top;font-size:13px}
.nx-seo-tbl tr:last-child td{border-bottom:0}
.nx-seo-types .nx-seo-select{min-width:150px}
.nx-seo-editrow td{background:var(--nx-muted)}
.nx-seo-select{appearance:none;-webkit-appearance:none;height:var(--nx-control-height-md);width:100%;max-width:170px;border:1px solid var(--nx-input);border-radius:6px;padding:0 30px 0 10px;background-color:var(--nx-background);background-image:linear-gradient(45deg,transparent 50%,var(--nx-muted-foreground) 50%),linear-gradient(135deg,var(--nx-muted-foreground) 50%,transparent 50%);background-position:calc(100% - 15px) 52%,calc(100% - 10px) 52%;background-size:5px 5px;background-repeat:no-repeat;color:var(--nx-foreground);font:inherit;font-size:14px;cursor:pointer;transition:border-color .15s}
.nx-seo-select:hover,.nx-seo-select:focus,.nx-seo-select:focus-visible{border-color:var(--nx-primary);outline:none}
.nx-seo-select[aria-invalid="true"]{border-color:var(--nx-warning-border)}
.nx-seo-sdstate .nx-seo-linkbtn,.nx-seo-sdstate .nx-seo-help,.nx-seo-sdstate .nx-seo-warnc{font-size:12px}
.nx-seo-mapline .nx-seo-select{max-width:none}
.nx-seo-note{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:8px;border:1px solid var(--nx-border);background:var(--nx-muted);font-size:13px;max-width:720px}
.nx-seo-note > svg{margin-top:2px;color:var(--nx-muted-foreground);flex:none}
.nx-seo-note b{font-weight:600}
.nx-seo-rgroup{display:grid;gap:6px}
.nx-seo-rgroup.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.nx-seo-radio{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--nx-border);border-radius:8px;background:var(--nx-card);cursor:pointer}
.nx-seo-radio:hover{background:var(--nx-accent)}
.nx-seo-radio:has(input:checked){border-color:var(--nx-foreground)}
.nx-seo-radio:has(input:focus-visible){outline:2px solid var(--nx-ring);outline-offset:2px}
.nx-seo-radio input{margin:3px 0 0;accent-color:var(--nx-primary);flex:none}
.nx-seo-radio b{font-weight:600;font-size:13px;display:block}
.nx-seo-radio span span{display:block;font-size:13px;color:var(--nx-muted-foreground);margin-top:2px}
.nx-seo-alert{margin:12px 24px 0;padding:10px 12px;border-radius:8px;border:1px solid var(--nx-danger-border);background:var(--nx-danger-surface);color:var(--nx-danger-text);font-size:13px}
.nx-seo-state{padding:40px 24px;color:var(--nx-muted-foreground);font-size:13px}
/* The dialog carries the root class itself; both together outrank its own layout. */
.nx-seo-warnc{color:var(--nx-warning-text);display:inline-flex;flex:none}
.nx-seo-okc{color:var(--nx-success-text);display:inline-flex;flex:none}
.nx-seo-phead > div:first-child{flex:1 1 360px;min-width:0}
.nx-seo .nx-seo-sbtn{height:28px;padding:0 9px;font-size:12px;gap:6px;border-radius:8px}
.nx-seo .nx-seo-sbtn svg{width:14px;height:14px}
.nx-seo-grow{flex:1;min-width:0}
.nx-seo-cnt.n{background:var(--nx-muted);color:var(--nx-muted-foreground);border-color:transparent;vertical-align:1px}
@media (max-width:720px){
.nx-seo-head{padding:18px 16px 0}
.nx-seo-tabs{padding:0 16px}
.nx-seo-body{padding:16px 16px 28px}
.nx-seo-alert{margin:12px 16px 0}
.nx-seo-rgroup.two{grid-template-columns:minmax(0,1fr)}
.nx-seo-select{max-width:none}
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
  | "arrow"
  | "upload"
  | "pen"
  | "refresh";

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
  upload: (
    <>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </>
  ),
  pen: <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
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
