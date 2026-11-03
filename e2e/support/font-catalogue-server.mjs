/**
 * A stand-in for the Google Fonts catalogue (Fontsource's api and jsDelivr's
 * file host) for the browser suite, so no test reaches the real network.
 *
 * Started by global setup, and stopped by the teardown it returns. The
 * playground is pointed at it through `NEXTLY_E2E_FONT_CATALOGUE`
 * (`playwright.config.ts`, read in `apps/playground/nextly.config.ts`). The
 * playground's SERVER downloads from it when a font is added; the editor's
 * BROWSER loads previews from it, so it answers cross-origin.
 *
 * Every family serves the same committed file, a Latin subset of Geist under
 * the SIL Open Font License (`e2e/fixtures/fonts/OFL.txt`). The family names
 * are this fixture's own, so a family on the published page can only have
 * come from the site.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT = readFileSync(
  path.join(HERE, "..", "fixtures", "fonts", "fixture-latin-wght-normal.woff2")
);
/**
 * This run's port: beside the playground's own, so parallel worktrees, each
 * on a port range of its own, do not collide.
 */
const PORT =
  Number(process.env.E2E_FONT_CATALOGUE_PORT) ||
  (Number(process.env.E2E_PORT) || 3100) + 7;

/** Where the stand-in answers, as the playground is told it. */
export const FONT_CATALOGUE_ORIGIN = `http://localhost:${String(PORT)}`;

const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC";

/** The catalogue: a variable family, a static one, and a long name. */
const FAMILIES = [
  {
    id: "fixture-sans",
    family: "Fixture Sans",
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal"],
    variable: true,
    category: "sans-serif",
  },
  {
    id: "fixture-serif",
    family: "Fixture Serif",
    weights: [400, 700],
    styles: ["normal", "italic"],
    variable: false,
    category: "serif",
  },
  {
    id: "big-shoulders-stencil-display",
    family: "Big Shoulders Stencil Display",
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["normal"],
    variable: true,
    category: "display",
  },
].map(family => ({
  ...family,
  subsets: ["latin"],
  defSubset: "latin",
  lastModified: "2026-01-01",
  license: "OFL-1.1",
  type: "google",
}));

/**
 * One family's metadata, as Fontsource's `/v1/fonts/<id>` answers it.
 *
 * @param {(typeof FAMILIES)[number]} family
 */
function metadata(family) {
  return { ...family, npmVersion: "5.0.0", unicodeRange: { latin: LATIN } };
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {unknown} body
 */
function json(res, body) {
  res.writeHead(200, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
function answer(req, res) {
  const url = new URL(req.url ?? "/", `http://localhost:${String(PORT)}`);
  if (url.pathname === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (url.pathname === "/v1/fonts") {
    json(res, FAMILIES);
    return;
  }
  const one = /^\/v1\/fonts\/([a-z0-9-]+)$/.exec(url.pathname);
  if (one !== null) {
    const family = FAMILIES.find(each => each.id === one[1]);
    if (family === undefined) res.writeHead(404).end();
    else json(res, metadata(family));
    return;
  }
  // Static and variable packages are released apart, as Fontsource's are,
  // so a variable add that pinned the static release would ask for a file
  // this stand-in does not have.
  const versions = /^\/v1\/version\/([a-z0-9-]+)$/.exec(url.pathname);
  if (versions !== null) {
    const family = FAMILIES.find(each => each.id === versions[1]);
    if (family === undefined) res.writeHead(404).end();
    else
      json(res, {
        latest: "5.0.0",
        ...(family.variable ? { latestVariable: "5.0.1" } : {}),
      });
    return;
  }
  if (
    /^\/fontsource\/fonts\/[a-z0-9:@.-]+\/[a-z0-9-]+\.woff2$/.test(url.pathname)
  ) {
    res.writeHead(200, {
      "content-type": "font/woff2",
      "content-length": FONT.length,
      "access-control-allow-origin": "*",
    });
    res.end(FONT);
    return;
  }
  res.writeHead(404).end();
}

/**
 * Start the stand-in; answers the function that stops it.
 *
 * @returns {Promise<() => Promise<void>>}
 */
export async function startFontCatalogue() {
  const server = createServer(answer);
  // Both address families, since `localhost` may resolve to either.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "::", () => resolve(undefined));
  });
  return () => new Promise(resolve => server.close(() => resolve(undefined)));
}
