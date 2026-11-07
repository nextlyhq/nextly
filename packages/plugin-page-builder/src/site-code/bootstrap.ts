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
 * as the parser reaches them: each external script that isn't `async` is
 * loaded before anything after it starts, as the parser would, and the
 * head's code finishes so before the body's starts. A script that writes
 * into the page as it loads (`document.write`) can't be site code, and a
 * stylesheet isn't waited for.
 *
 * A path is skipped when any `<SiteCode>` on the page skips it: each loader
 * reads every data block's list, so the head and the end of the body never
 * disagree about where code may run.
 *
 * A navigation within the app that crosses into or out of a path the loader
 * skips (a `<Link>` into `/admin`, Back out of it) loads the new page afresh:
 * code that ran never shares a document with the admin, and a public page
 * reached from the admin starts its code as on any first load.
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
 * Where the loaders keep one queue for the document, on its root element:
 * each place's code starts once the place before it has finished, so a
 * script the head waits on has loaded before the body's code starts, as it
 * would have had both been written in the page.
 */
const QUEUE_PROPERTY = "nxSiteCodeQueue";

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
  function skipList() {
    var paths = [];
    document.querySelectorAll("script[${SITE_CODE_DATA_ATTRIBUTE}]").forEach(function (other) {
      try {
        paths = paths.concat(JSON.parse(other.textContent || "{}").skip || []);
      } catch (e) {}
    });
    return paths;
  }
  function skippedIn(paths) {
    return paths.some(function (path) {
      return location.pathname === path || location.pathname.indexOf(path + "/") === 0;
    });
  }
  function guardNavigation(paths) {
    var root = document.documentElement;
    if (root.hasAttribute("${SITE_CODE_DATA_ATTRIBUTE}-guard")) return;
    root.setAttribute("${SITE_CODE_DATA_ATTRIBUTE}-guard", "");
    var wasSkipped = skippedIn(paths);
    function leaveIfSkipped() {
      if (skippedIn(paths) !== wasSkipped) location.reload();
    }
    ["pushState", "replaceState"].forEach(function (name) {
      var original = history[name];
      history[name] = function () {
        var result = original.apply(history, arguments);
        leaveIfSkipped();
        return result;
      };
    });
    window.addEventListener("popstate", leaveIfSkipped);
  }
  function build(entry) {
    var element = document.createElement(entry.tag);
    var attrs = entry.attrs || {};
    Object.keys(attrs).forEach(function (name) {
      element.setAttribute(name, attrs[name]);
    });
    if (nonce) element.nonce = nonce;
    if (typeof entry.text === "string") element.textContent = entry.text;
    return element;
  }
  function start() {
    if (framedBySite() || document.querySelector("[${CANVAS_MOUNT_ATTRIBUTE}]")) return;
    // Read once the page has parsed, before any code starts, so code that
    // later edits or removes the data blocks never changes where it may run.
    var paths = skipList();
    guardNavigation(paths);
    if (skippedIn(paths)) return;
    var root = document.documentElement;
    root.setAttribute("${SITE_CODE_DATA_ATTRIBUTE}-" + data.slot, "started");
    var into = data.slot === "head" ? document.head : document.body;
    var entries = data.entries || [];
    function run(done) {
      function next(index) {
        if (index >= entries.length) return done();
        var entry = entries[index];
        var attrs = entry.attrs || {};
        var element = build(entry);
        var waits = entry.tag === "script" && attrs.src !== undefined && attrs.async === undefined;
        if (waits) {
          element.async = false;
          var go = function () {
            next(index + 1);
          };
          element.addEventListener("load", go);
          element.addEventListener("error", go);
        }
        into.appendChild(element);
        if (!waits) next(index + 1);
      }
      try {
        next(0);
      } catch (e) {
        done();
      }
    }
    var queue = root.${QUEUE_PROPERTY} || Promise.resolve();
    root.${QUEUE_PROPERTY} = queue.then(function () {
      return new Promise(run);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();`;
