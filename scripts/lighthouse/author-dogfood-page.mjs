/**
 * Writes the dogfood page into a running production server, so there is
 * something for Lighthouse to measure.
 *
 * ## Why the page is authored rather than seeded
 *
 * The playground seed creates users, categories, tags, posts and media, and no
 * page-builder content at all. Every public route therefore renders an empty
 * document until something writes one. Measuring that empty page would produce
 * a score describing the framework's shell rather than a page, and a threshold
 * set against it could never fail for a content reason.
 *
 * ## Why it goes through the HTTP API rather than the database
 *
 * The claim a performance run makes is about what the product serves for
 * content the product accepted. A row written directly can hold a shape the
 * write path would have rejected — a block the validator refuses, a slot whose
 * child type is not allowed there — and the renderer would then be measured
 * against a document no editor could have produced.
 *
 * ## Why media is resolved instead of hard-coded
 *
 * Media ids are generated per database, so a checked-in document cannot name
 * one. The fixture carries `@media:<original filename>` and this resolves each
 * against the media library the seed populated, which keeps the document
 * declarative and portable across a reset.
 *
 * @module scripts/lighthouse/author-dogfood-page
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.LH_BASE_URL ?? "http://localhost:3111";
const EMAIL = process.env.LH_ADMIN_EMAIL ?? "dev@nextly.local";
const PASSWORD = process.env.LH_ADMIN_PASSWORD ?? "DevPassword123!";
const SINGLE_SLUG = "homepage";
const FIELD = "layout";

/** Marks a prop whose value is a media id to be resolved by original filename. */
const MEDIA_PREFIX = "@media:";

const jar = new Map();

function remember(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

const cookieHeader = () =>
  [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

/**
 * Signs in the way the admin does.
 *
 * The token is read from its own endpoint and echoed in the header, because the
 * server compares the two and rejects a request carrying only the cookie. The
 * origin is stated for the same reason: the check is double-submit plus an
 * origin comparison, and a request with neither is refused before the password
 * is ever looked at.
 */
async function signIn() {
  const csrfResponse = await fetch(`${BASE_URL}/admin/api/auth/csrf`);
  if (!csrfResponse.ok) {
    throw new Error(`CSRF request failed: ${csrfResponse.status}`);
  }
  remember(csrfResponse);
  const { token } = await csrfResponse.json();

  const response = await fetch(`${BASE_URL}/admin/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": token,
      origin: BASE_URL,
      referer: `${BASE_URL}/admin`,
      cookie: cookieHeader(),
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(
      `sign-in failed: ${response.status} ${await response.text()}`
    );
  }
  remember(response);
  return token;
}

/** Maps every seeded asset's original filename to the id the document needs. */
async function mediaByFilename() {
  const response = await fetch(`${BASE_URL}/admin/api/media?limit=100`, {
    headers: { cookie: cookieHeader() },
  });
  if (!response.ok) {
    throw new Error(`media listing failed: ${response.status}`);
  }
  const { items } = await response.json();
  return new Map(items.map(item => [item.originalFilename, item.id]));
}

/**
 * Replaces every media placeholder with a real id.
 *
 * Throws on a placeholder that resolves to nothing rather than passing the
 * literal through. An unresolved id reaches the renderer as a missing asset,
 * which draws nothing and costs no bytes — so the run would still score, and
 * would score a page missing the largest element on it.
 */
function resolveMedia(node, media) {
  const props = Object.fromEntries(
    Object.entries(node.props ?? {}).map(([name, value]) => {
      if (typeof value !== "string" || !value.startsWith(MEDIA_PREFIX)) {
        return [name, value];
      }
      const filename = value.slice(MEDIA_PREFIX.length);
      const id = media.get(filename);
      if (id === undefined) {
        throw new Error(
          `the fixture names media "${filename}", which the library does not have; ` +
            `seed the playground before authoring (available: ${[...media.keys()].join(", ") || "none"})`
        );
      }
      return [name, id];
    })
  );

  const slots =
    node.slots === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(node.slots).map(([name, children]) => [
            name,
            children.map(child => resolveMedia(child, media)),
          ])
        );

  return { ...node, props, ...(slots === undefined ? {} : { slots }) };
}

/**
 * Undoes the escaping the renderer applies, so a marker is compared against the
 * text a reader sees rather than against its markup spelling.
 *
 * Authored copy reaches the page escaped: an ampersand becomes `&amp;`, an
 * apostrophe in an attribute becomes `&#x27;`. Comparing raw fixture text
 * against raw HTML therefore reports a missing marker for an element that
 * rendered perfectly — a false failure whose message points at the page when
 * the fault is in the comparison. Attributes and text nodes also escape
 * different sets, so decoding the page is the one operation that covers both.
 *
 * `&amp;` is decoded last. Doing it first would turn `&amp;lt;` — an escaped
 * ampersand followed by the letters — into `&lt;`, which the next pass would
 * then read as a character it never was.
 */
function decodeEntities(html) {
  return html
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/**
 * The strings the rendered page must contain, read out of the document rather
 * than written down beside it.
 *
 * Every heading and every image's alt text, so the check fails if any of them
 * stops rendering. The images are the half a headline check cannot stand in
 * for: the image block returns nothing at all when media resolution or URL
 * filtering rejects an asset, and a page that quietly drops both images still
 * renders its prose, still answers 200, and then scores BETTER, because every
 * budget in the assertion set is a maximum. A run like that would report a
 * healthier number for a page that had lost its largest element.
 *
 * Derived rather than listed so the two cannot drift: editing the fixture's
 * copy changes what is required, with nothing here to keep in step.
 */
/**
 * What each block type contributes to the required set, keyed by type.
 *
 * A table rather than a chain of tests inside the walk, so the walk does one
 * thing — descend — and a block added here cannot make it harder to read.
 */
const MARKERS_BY_TYPE = {
  "core/heading": props => (typeof props.text === "string" ? [props.text] : []),
  "core/image": props =>
    typeof props.alt === "string" && props.decorative !== true
      ? [props.alt]
      : [],
  // A list's text is a PROP rather than child nodes, so a walk that only
  // descended into slots would take nothing from it — and a list that stopped
  // rendering would leave the guard satisfied by the prose around it and the
  // measurement BETTER for having lost content.
  "core/list": props =>
    Array.isArray(props.items)
      ? props.items.filter(item => typeof item === "string" && item !== "")
      : [],
};

function expectedMarkers(node) {
  const markers = [];
  const visit = current => {
    const contribute = MARKERS_BY_TYPE[current.type];
    if (contribute !== undefined) markers.push(...contribute(current.props ?? {}));
    for (const children of Object.values(current.slots ?? {})) {
      for (const child of children) visit(child);
    }
  };
  for (const top of node.nodes) visit(top);
  return markers;
}

async function main() {
  const csrf = await signIn();
  const media = await mediaByFilename();

  const fixture = JSON.parse(
    await readFile(path.join(HERE, "dogfood-page.json"), "utf8")
  );
  const document = {
    ...fixture,
    nodes: fixture.nodes.map(node => resolveMedia(node, media)),
  };

  const response = await fetch(
    `${BASE_URL}/admin/api/singles/${SINGLE_SLUG}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf,
        origin: BASE_URL,
        referer: `${BASE_URL}/admin`,
        cookie: cookieHeader(),
      },
      body: JSON.stringify({ [FIELD]: document }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `authoring failed: ${response.status} ${await response.text()}`
    );
  }

  // The write returning 200 is not the whole assertion. The measured page is
  // fetched as a signed-out visitor, and a document that saved but does not
  // render publicly would leave Lighthouse scoring an empty page while this
  // step reported success.
  const visitor = await fetch(`${BASE_URL}/`, { headers: { cookie: "" } });
  const html = await visitor.text();

  const rendered = decodeEntities(html);
  const missing = expectedMarkers(document).filter(
    marker => !rendered.includes(marker)
  );
  if (missing.length > 0) {
    throw new Error(
      `the authored page is not being served to an anonymous visitor as ` +
        `written: GET / returned ${visitor.status} without ` +
        missing.map(marker => JSON.stringify(marker)).join(", ")
    );
  }

  console.log(
    `[lighthouse] authored ${SINGLE_SLUG}.${FIELD} and confirmed it renders at ${BASE_URL}/`
  );
}

await main();
