/**
 * A stand-in for the playground, for the visual check's tests: a plain HTTP
 * server on a free port serving fixed pages, so the capture and the page
 * checks run against a real browser without a Next build.
 *
 * Each page holds exactly one thing a check should find, or nothing, so a test
 * can name what it expects and know where it came from.
 *
 * @module scripts/visual-check/fixture-server
 */
import { createServer } from "node:http";

/** A whole page around `body`, labelled and titled so axe's AA rules have nothing else to say. */
const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture</title><style>body{margin:0;font:16px sans-serif;background:#fff;color:#111}a{color:inherit}nav ul{display:flex;gap:8px;list-style:none;margin:0;padding:0}nav a{display:inline-block;min-width:24px;min-height:24px;padding:4px}@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}</style>`;

/**
 * The chrome an admin screen draws round its content: a labelled navigation
 * list, a labelled search field and a logo. Enough for axe to judge, as it
 * judges a real screen; a page with less is one axe checked nothing on.
 */
const CHROME = `<header><img alt="Fixture" width="16" height="16" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><nav aria-label="Main"><ul><li><a href="/admin">Dashboard</a></li><li><a href="/admin/media">Media</a></li></ul></nav><form role="search"><label for="q">Search</label><input id="q" type="search"></form></header>`;

/** A whole admin-like page around `body`, titled and labelled so axe's AA rules have nothing else to say. */
function page(body, head = "") {
  return `<!doctype html><html lang="en"><head>${HEAD}${head}</head><body>${CHROME}<main><h1>Fixture</h1>${body}</main></body></html>`;
}

/**
 * The same page drawn inside the admin's root, `.nextly-admin`, whose palette
 * the admin applies after mount by adding `dark`. `script` is what applies it,
 * or nothing, for a page whose dark scheme never arrives.
 */
function adminPage(body, script = "") {
  return `<!doctype html><html lang="en"><head>${HEAD}</head><body><div class="nextly-admin">${CHROME}<main><h1>Fixture</h1>${body}</main></div>${script}</body></html>`;
}

/** The cookie the tests' stand-in sign-in sets, which a fixture can tell a signed-in visitor by. */
export const FIXTURE_SESSION_COOKIE = "fixture_session";

/** Whether a request carries the stand-in session. */
function signedIn(request) {
  return new RegExp(`(?:^|;\\s*)${FIXTURE_SESSION_COOKIE}=`).test(
    request.headers.cookie ?? ""
  );
}

/** What each path answers: a status, and a page or a redirect target. */
const FIXTURE_PAGES = {
  // Clean, and taller than every viewport, so a full-page capture is taller than a viewport one.
  "/admin": {
    status: 200,
    html: page('<div style="height:2400px">Tall content</div>'),
  },
  // At 390 px the box is wider than the viewport, so the box ends past the right edge. The
  // table is wider still but sits in a scrolling container, so no reader sees it past the edge.
  // The hidden box is never drawn yet still takes its 900 px of layout, so the document scrolls
  // sideways that far while the box is not named as an element anyone sees.
  "/admin/wide": {
    status: 200,
    html: page(
      '<div class="wide-box" style="width:600px">Wide</div>' +
        '<div style="overflow-x:auto;width:100%"><table class="scrolled" style="width:800px"><tbody><tr><td>Cell</td></tr></tbody></table></div>' +
        '<div class="hidden-box" style="width:900px;visibility:hidden">Hidden</div>'
    ),
  },
  // A button with no accessible name: axe's `button-name`, of critical impact.
  "/admin/unlabelled": {
    status: 200,
    html: page('<button class="icon-only" type="button"></button>'),
  },
  "/admin/missing": { status: 404, html: page("<p>Not found</p>") },
  // What a signed-out visitor gets: sent on to the sign-in page, which answers 200.
  "/admin/private": { status: 307, location: "/admin/login" },
  "/admin/login": { status: 200, html: page("<p>Sign in</p>") },
  // Answers its first request and is gone after, so a route can fail part way through its views.
  "/admin/once": { status: 200, html: page("<p>Here once</p>"), once: true },
  // Answers 200 and never draws a screen: the chrome, and no `main`.
  "/admin/blank": {
    status: 200,
    html: `<!doctype html><html lang="en"><head>${HEAD}</head><body>${CHROME}<p>Loading</p></body></html>`,
  },
  // Applies the stored scheme to the admin's root after mount, as the admin does.
  "/admin/themed": {
    status: 200,
    html: adminPage(
      "<p>Themed</p>",
      `<script>setTimeout(() => { if (localStorage.getItem("nextly-theme") === "dark") document.querySelector(".nextly-admin").classList.add("dark"); }, 100);</script>`
    ),
  },
  // The admin's root, whose dark scheme never arrives.
  "/admin/stuck-light": { status: 200, html: adminPage("<p>Always light</p>") },
  // A public screen, as the admin's sign-up is: a signed-in visitor is turned away.
  "/admin/register": {
    signedIn: { status: 403, html: page("<p>Already signed in</p>") },
    signedOut: { status: 200, html: page("<p>Create an account</p>") },
  },
  // A private screen: a visitor with no session is sent to sign in.
  "/admin/members-only": {
    signedIn: { status: 200, html: page("<p>Members only</p>") },
    signedOut: { status: 307, location: "/admin/login" },
  },
  // A screen with a dialog, opened by its button. The dialog is wider than a
  // phone, so a check of the page names it when, and only when, it is open.
  "/admin/dialog": {
    status: 200,
    html: page(
      '<button type="button" onclick="document.getElementById(\'fixture-dialog\').hidden = false">Open filters</button>' +
        '<div id="fixture-dialog" role="dialog" aria-label="Filters" hidden style="position:fixed;top:40px;left:0;width:600px;background:#fff;color:#111"><p>Filters</p></div>'
    ),
  },
  // Draws a `main`, and nothing else axe could judge.
  "/admin/bare": {
    status: 200,
    html: `<!doctype html><html lang="en"><head><title>Bare</title></head><body><main>Bare</main></body></html>`,
  },
};

/**
 * What a request is answered with: its page's answer, picked by session for a
 * page that answers by one, and the missing page for a path not listed or a
 * page that answers once and already has.
 */
function answerFor(request, served) {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const listed = FIXTURE_PAGES[path];
  const known =
    listed?.signedIn && listed?.signedOut
      ? listed[signedIn(request) ? "signedIn" : "signedOut"]
      : listed;
  const gone = known?.once && served.has(path);
  served.add(path);
  return known && !gone ? known : FIXTURE_PAGES["/admin/missing"];
}

/**
 * Starts the server on a free port of localhost and resolves its base URL and a
 * way to stop it.
 *
 * @returns {Promise<{ baseURL: string, port: number, close: () => Promise<void> }>}
 */
export async function startFixtureServer() {
  const served = new Set();
  const server = createServer((request, response) => {
    const answer = answerFor(request, served);
    if (answer.location) {
      response.writeHead(answer.status, { location: answer.location });
      response.end();
      return;
    }
    response.writeHead(answer.status, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end(answer.html);
  });
  await new Promise(resolve => server.listen(0, "localhost", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseURL: `http://localhost:${port}`,
    port,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}
