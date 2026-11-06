/**
 * How site code is started on a page, so that it never runs inside the admin.
 *
 * The admin, the editor's canvas and the preview pane are served from the
 * site's own origin, so code running in any of them can read and drive the
 * admin window. A host may also mount `<SiteCode>` in a root layout the admin
 * shares. The server cannot tell those pages apart without reading the
 * request, which would make every published page dynamic, so the code itself
 * decides, in the browser:
 * - what runs (scripts), applies (styles) or styles the page (stylesheet
 *   links) is written to the page as inert data, never as elements;
 * - one fixed loader (`SITE_CODE_BOOTSTRAP`) builds those elements, with DOM
 *   calls and never from HTML, only on a page that is not framed by a page of
 *   its own site (the canvas, the preview), not under a path it is told to
 *   skip (`/admin`), and not the canvas itself;
 * - everything else (meta tags, link hints and icons, structured data, a
 *   no-script pixel) is inert in the admin and is written as is, so crawlers
 *   and pages without scripting see it.
 *
 * The loader passes its own nonce on to what it builds, and its text never
 * changes, so a hash-based policy allows it by one fixed hash.
 *
 * Scripts it builds run in order, as the page finishes parsing, rather than
 * as the parser reaches them: a script that writes into the page as it loads
 * (`document.write`) can't be site code.
 *
 * @module site-code/bootstrap
 * @experimental
 */
import { CANVAS_MOUNT_ATTRIBUTE } from "../canvas/attributes";

import {
  siteCodeLinkRelations,
  siteCodeScriptKind,
  type SiteCodeEntry,
} from "./rules";

/**
 * Whether an entry is started by the loader rather than written as is: a
 * script that runs, a style, or a stylesheet link.
 */
export function isGatedSiteCode(entry: SiteCodeEntry): boolean {
  switch (entry.tag) {
    case "script":
      return siteCodeScriptKind(entry.attrs.type) !== "data";
    case "style":
      return true;
    case "link":
      return siteCodeLinkRelations(entry.attrs.rel).includes("stylesheet");
    default:
      return false;
  }
}

/** The attribute naming the data block a loader reads: its slot. */
export const SITE_CODE_DATA_ATTRIBUTE = "data-nx-site-code";

/**
 * The loader, as it is written to every page carrying gated site code. It
 * reads the data block just before it, and builds each entry where its slot
 * says, once the page has parsed. Its text is fixed: a policy allows it by
 * its hash, and a change here changes that hash for every site.
 */
export const SITE_CODE_BOOTSTRAP: string = `(function () {
  var me = document.currentScript;
  var block = me && me.previousElementSibling;
  if (!block || !block.hasAttribute("${SITE_CODE_DATA_ATTRIBUTE}")) return;
  var data = JSON.parse(block.textContent || "{}");
  var nonce = me.nonce || "";
  function framedBySite() {
    try {
      return window.top !== window && window.top.location.origin === location.origin;
    } catch (e) {
      return false;
    }
  }
  function skipped() {
    return (data.skip || []).some(function (path) {
      return location.pathname === path || location.pathname.indexOf(path + "/") === 0;
    });
  }
  function start() {
    if (framedBySite() || skipped() || document.querySelector("[${CANVAS_MOUNT_ATTRIBUTE}]")) return;
    var into = data.slot === "head" ? document.head : document.body;
    (data.entries || []).forEach(function (entry) {
      var element = document.createElement(entry.tag);
      var attrs = entry.attrs || {};
      Object.keys(attrs).forEach(function (name) {
        element.setAttribute(name, attrs[name]);
      });
      if (nonce) element.nonce = nonce;
      if (entry.tag === "script" && attrs.src !== undefined && attrs.async === undefined) element.async = false;
      if (typeof entry.text === "string") element.textContent = entry.text;
      into.appendChild(element);
    });
    document.documentElement.setAttribute("${SITE_CODE_DATA_ATTRIBUTE}-" + data.slot, "started");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();`;
