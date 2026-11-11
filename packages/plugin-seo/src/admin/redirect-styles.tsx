/**
 * The redirects screen's own styles, on top of the SEO screens' shared ones
 * (`styles`): the add form, a redirect's type and who added it, the import's
 * dry run, and the visits bar of an address not found. Scoped to `.nx-seo`
 * and drawn only from the admin's `--nx-*` tokens, so light and dark follow.
 *
 * @module admin/redirect-styles
 */
import type { JSX } from "react";

const CSS = `
.nx-seo-cnt.n{background:var(--nx-muted);color:var(--nx-muted-foreground);border-color:var(--nx-border)}
.nx-seo-addform{display:grid;grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr) 160px auto;gap:8px;align-items:end;padding:14px;border:1px solid var(--nx-border);border-radius:10px;background:var(--nx-card)}
.nx-seo-addform .nx-seo-arrow{align-self:center;padding-top:20px;color:var(--nx-muted-foreground);display:grid;place-items:center}
.nx-seo-addform label{font-size:12px;font-weight:600;color:var(--nx-muted-foreground);display:block;margin-bottom:4px}
.nx-seo-addform .nx-seo-msg{grid-column:1/-1;font-size:13px;line-height:1.45;min-height:19px}
.nx-seo-addform .nx-seo-msg .nx-seo-warnc,.nx-seo-addform .nx-seo-msg .nx-seo-okc,.nx-seo-inline{display:inline}
.nx-seo-listbox{margin-top:14px}
.nx-seo-editacts{gap:6px}
.nx-seo-strong{color:var(--nx-foreground);font-weight:600}
.nx-seo-nflead{margin:0 0 12px}
.nx-seo-end{text-align:right}
.nx-seo-addform .nx-seo-msg code{font-family:var(--seo-mono);font-size:12px;background:var(--nx-muted);padding:1px 5px;border-radius:4px}
.nx-seo-in{width:100%;height:36px;border:1px solid var(--nx-control-border,var(--nx-input));border-radius:8px;background:var(--nx-background);color:var(--nx-foreground);padding:0 10px;font-family:var(--seo-mono);font-size:13px}
.nx-seo-in::placeholder{color:var(--nx-muted-foreground)}
.nx-seo-in[aria-invalid="true"]{border-color:var(--nx-danger-border)}
select.nx-seo-in{font-family:inherit}
.nx-seo-rtbl td.nx-seo-mono,.nx-seo-rtbl td .nx-seo-mono{overflow-wrap:anywhere}
.nx-seo-rtbl td{vertical-align:middle}
.nx-seo-rtbl td.nx-seo-from{max-width:340px}
.nx-seo-addr{overflow-wrap:break-word}
.nx-seo-rtbl td.nx-seo-nowrap{white-space:nowrap}
.nx-seo-pill{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--nx-muted);color:var(--nx-foreground);white-space:nowrap}
.nx-seo-pill.t{background:transparent;border:1px dashed var(--nx-muted-foreground)}
.nx-seo-who{display:flex;align-items:center;gap:6px;color:var(--nx-muted-foreground);font-size:13px;white-space:nowrap}
.nx-seo-avatar{width:20px;height:20px;border-radius:999px;background:var(--nx-muted);color:var(--nx-foreground);display:grid;place-items:center;font-size:12px;font-weight:600;flex:none}
.nx-seo-rowacts{display:flex;gap:2px;justify-content:flex-end;white-space:nowrap}
.nx-seo-iconbtn{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--nx-muted-foreground);display:inline-grid;place-items:center;cursor:pointer}
.nx-seo-iconbtn:hover{background:var(--nx-muted);color:var(--nx-foreground)}
.nx-seo-editrow td{background:var(--nx-table-row-hover,var(--nx-muted))}
.nx-seo-rowerr{margin:0;display:flex;gap:6px;align-items:flex-start;color:var(--nx-danger-text);font-size:13px}
.nx-seo-impbox{border:1px solid var(--nx-foreground);border-radius:10px;background:var(--nx-card);overflow:hidden;margin-bottom:14px}
.nx-seo-imp-h{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--nx-border-subtle);flex-wrap:wrap}
.nx-seo-imp-h.foot{border-top:1px solid var(--nx-border-subtle);border-bottom:0}
.nx-seo-imp-h:not(.foot){flex-wrap:nowrap;align-items:flex-start}
.nx-seo-imp-h b{font-size:14px;font-weight:600}
.nx-seo-imp-acts{display:flex;gap:6px;flex-wrap:wrap}
.nx-seo-res{display:inline-flex;align-items:flex-start;gap:6px;font-size:13px;font-weight:600}
.nx-seo-res > svg{margin-top:1px}
.nx-seo-res.new{color:var(--nx-success-text)}
.nx-seo-res.warn{color:var(--nx-warning-text)}
.nx-seo-res.bad{color:var(--nx-danger-text)}
.nx-seo-res.same{color:var(--nx-muted-foreground)}
.nx-seo-badrow td{background:var(--nx-warning-surface)}
.nx-seo-hits{font-variant-numeric:tabular-nums;font-weight:600}
.nx-seo-hitbar{display:inline-block;height:6px;border-radius:999px;background:var(--nx-foreground);vertical-align:middle;margin-left:8px;opacity:.75}
.nx-seo-moved{display:block;margin-top:2px;font-family:inherit;font-size:12px;color:var(--nx-warning-text)}
.nx-seo-empty{padding:36px 20px;text-align:center}
.nx-seo-empty b{font-size:14px;font-weight:600}
.nx-seo-empty p{margin:4px 0 0}
.nx-seo-dangerc{color:var(--nx-danger-text);font-weight:600}
.nx-seo-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:1180px){
.nx-seo-addform{grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr)}
.nx-seo-addform .nx-seo-typefield{grid-column:1}
.nx-seo-addform .nx-seo-addbtn{grid-column:3;justify-self:start}
}
@media (max-width:720px){
.nx-seo-addform{grid-template-columns:minmax(0,1fr)}
.nx-seo-addform .nx-seo-typefield,.nx-seo-addform .nx-seo-addbtn{grid-column:1;justify-self:stretch}
.nx-seo-addform .nx-seo-arrow{display:none}
.nx-seo-rtbl thead{display:none}
.nx-seo-rtbl tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;padding:12px;border-bottom:1px solid var(--nx-border-subtle)}
.nx-seo-rtbl tr:last-child{border-bottom:0}
.nx-seo-rtbl td{display:block;padding:0;border:0;grid-column:1}
.nx-seo-rtbl td[data-label]::before{content:attr(data-label);display:block;font-size:12px;font-weight:600;color:var(--nx-muted-foreground);margin-bottom:2px}
.nx-seo-rtbl td.nx-seo-rowcell{grid-column:2;grid-row:1/span 3;align-self:start}
.nx-seo-rtbl td.nx-seo-wide{grid-column:1/-1}
}
`;

/** The redirects screen's styles, placed once in the document's head. */
export function RedirectStyles(): JSX.Element {
  return (
    <style href="nextly-plugin-seo-redirects" precedence="default">
      {CSS}
    </style>
  );
}
