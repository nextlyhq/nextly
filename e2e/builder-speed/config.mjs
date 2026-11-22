/**
 * The speed check's settings: where it runs, what it measures on, and the
 * command-line options (`measure.mjs` lists them), read once for every module
 * of the check.
 *
 * @module builder-speed/config
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
const PLAYGROUND = path.join(ROOT, "apps", "playground");
export const PRELOAD = path.join(ROOT, "e2e", "admin-speed", "preload.mjs");
export const DIST_DIR = ".next-builder-speed";
export const DB_FILE = path.join(PLAYGROUND, "data", "builder-speed.db");
export const DB_URL = "file:./data/builder-speed.db";
// A port of its own, so a server of another check never answers this one.
export const PORT = Number(process.env.BUILDER_SPEED_PORT || 3104);
export const SECRET =
  "builder-speed-check-secret-not-for-production-0123456789";
/** Where the results, the statement log and any failure's screenshot go. */
export const OUT_DIR = path.join(ROOT, "e2e", ".playwright", "builder-speed");

const argv = process.argv.slice(2);
export const flag = name => argv.includes(`--${name}`);
export const option = name => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

export const RATE = Number(option("rate") ?? 4);
export const SAMPLES = Number(option("samples") ?? 10);
export const ONLY = option("only")?.split(",");
export const BASE = (option("base-url") ?? `http://localhost:${PORT}`).replace(
  /\/$/,
  ""
);
export const OWN_SERVER = option("base-url") === undefined;
export const USER = {
  email: process.env.BUILDER_SPEED_EMAIL ?? "dev@nextly.local",
  password: process.env.BUILDER_SPEED_PASSWORD ?? "DevPassword123!",
};

/** The fixture's slugs and the ids the script acts on (`seed/speed-fixture`). */
export const SLUGS = {
  large: "speed-fixture-150",
  small: "speed-fixture-4",
  twenty: "speed-fixture-20",
  thirtyEight: "speed-fixture-38",
};
export const HEADING = "speed-hero-heading";
export const LEAD = "speed-hero-lead";
/**
 * Four wide blocks in the first view of the large page, for the quick
 * clicks: wide, so each click can land clear of the toolbar that floats over
 * the block above the selected one.
 */
export const QUICK = [HEADING, LEAD, "speed-hero-image", "speed-logos-line"];

/** How long a result may take to show before the sample reads as not shown. */
export const SHOW_LIMIT_MS = 60_000;
/** How long the keystroke row waits for the canvas before the field is left. */
export const KEYSTROKE_LIMIT_MS = 3000;
/** Quiet after an action: no admin request started or open for this long. */
export const QUIET_MS = 1500;
/** The round-trip latency the slow-network open adds, as the budget names. */
export const LATENCY_MS = 150;
export const IDLE_MS = 60_000;
export const FOOTER_REST_MS = 5000;
export const HEAP_SELECTIONS = 200;
export const HEAP_INSERTS = 50;

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function wanted(...ids) {
  return ONLY === undefined || ids.some(id => ONLY.includes(id));
}
