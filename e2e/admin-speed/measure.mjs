/**
 * The admin speed check: how many statements a production start sends, and
 * how many admin requests, rounds and statements each main screen costs, on
 * every dialect, compared with the numbers pinned in `pins.json`.
 *
 * Each run starts the playground's production build cold, with `preload.mjs`
 * loaded into the server so every statement it sends is logged (and held, for
 * the delayed start, as a far-away database would). The start is every
 * statement until the database falls quiet, the work it leaves running after
 * Nextly says it has started included. A browser then opens the sign-in
 * screen, signs in, and opens the dashboard, a collection list and an entry's
 * edit page, each in a fresh tab.
 *
 *   node e2e/admin-speed/measure.mjs [--build] [--dialects sqlite,postgresql,mysql]
 *                                    [--update-pins] [--json out.json]
 *
 * A count above its pin fails, naming it. So does one below its pin: a change
 * that makes the admin cheaper lowers the pin in the same pull request
 * (`--update-pins` writes the measured values). Statement counts move by a few
 * between runs (polling and background work), so they are compared with a
 * slack of `STATEMENT_SLACK`; requests are compared exactly and rounds with a
 * slack of one, since a round is judged from timing.
 *
 * Two comparisons run on PostgreSQL alone, start only: the same start with
 * every round trip delayed by `DELAY_MS`, and with `EXTRA_COLLECTIONS` more
 * collections. Each is pinned as growth over the plain start; a start that
 * does a fixed amount of work grows by nothing, and that pin can only fall.
 * The delayed start also fails when the admin page's first byte, asked for as
 * the server listens, takes longer than `FIRST_BYTE_LIMIT_MS`.
 *
 * PostgreSQL and MySQL need `E2E_DB_SERVER_URL_POSTGRESQL` and
 * `E2E_DB_SERVER_URL_MYSQL` (a server address with no database), or the
 * defaults of `../support/e2e-database.mjs`; each run creates and drops a
 * database of its own there.
 *
 * @module admin-speed/measure
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { e2eDatabase } from "../support/e2e-database.mjs";
import {
  dropServerDatabase,
  recreateServerDatabase,
} from "../support/server-database.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const PLAYGROUND = path.join(ROOT, "apps", "playground");
const PINS_FILE = path.join(HERE, "pins.json");
const PRELOAD = path.join(HERE, "preload.mjs");
const DIST_DIR = ".next-admin-speed";
// A port of its own, never the production suite's (`E2E_PROD_PORT`): a server
// of another run already listening there would answer this check's browser
// while its statements came from this run's server.
const PORT = Number(process.env.ADMIN_SPEED_PORT || 3103);
const BASE = `http://localhost:${PORT}`;
const SECRET = "admin-speed-check-secret-not-for-production-0123456789";
const USER = { email: "dev@nextly.local", password: "DevPassword123!" };

const STATEMENT_SLACK = 0.05;
/**
 * A screen's statements move more than a start's from run to run, while a
 * few requests are still sometimes sent twice (`racy` in the pins); they are
 * held to this until those duplicates are gone, then to `STATEMENT_SLACK`.
 */
const SCREEN_STATEMENT_SLACK = 0.15;
/** The least a growth pin allows either way, as two starts differ by a few. */
const GROWTH_SLACK_MIN = 5;
const ROUND_SLACK = 1;
const DELAY_MS = 100;
/**
 * How soon the admin page's first byte must arrive after the server listens,
 * on the delayed start: the page needs no database, so the start under way
 * must not hold it. A start that held it took about 104 s; one that does not
 * leaves the page's own first render, about 2 s on a cold server with or
 * without the delay, so this catches the start holding the page without
 * judging that render. Lowered to a second once the page is prebuilt.
 */
const FIRST_BYTE_LIMIT_MS = 10_000;
const EXTRA_COLLECTIONS = 45;
const QUIET_MS = 1500;
/** How long an open request is waited for once nothing else happens. */
const OPEN_WAIT_MS = 10_000;
/** How many times each screen is loaded; see `steady`. */
const SAMPLES = 5;
/** How long the database must be quiet before a start counts as finished. */
const START_QUIET_MS = 4000;

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = name => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const DIALECTS = (option("dialects") ?? "sqlite,postgresql,mysql").split(",");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, env) {
  const result = spawnSync(command, {
    cwd: ROOT,
    env,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(`"${command}" ended with ${result.status}`);
}

async function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

/** The database a run of `dialect` uses, made empty, and the env that points at it. */
async function freshDatabase(dialect, extra) {
  if (dialect === "sqlite") {
    const file = path.join(PLAYGROUND, "data", "admin-speed.db");
    for (const suffix of ["", "-shm", "-wal"])
      fs.rmSync(file + suffix, { force: true });
    return { database: null, url: "file:./data/admin-speed.db" };
  }
  const serverUrl = process.env[`E2E_DB_SERVER_URL_${dialect.toUpperCase()}`];
  const database = e2eDatabase({
    port: PORT,
    env: {
      E2E_DB_DIALECT: dialect,
      ...(serverUrl ? { E2E_DB_SERVER_URL: serverUrl } : {}),
    },
  });
  await recreateServerDatabase(database);
  return { database, url: database.url, extra };
}

/**
 * The environment of a run. Only the server is production: the seed and the
 * plugin install prepare the database as the production browser suite's do,
 * which a production start refuses to do itself.
 */
function serverEnv(
  dialect,
  url,
  { delay = 0, extra = 0, log, production = false } = {}
) {
  const { NODE_ENV: _inherited, ...base } = process.env;
  return {
    ...base,
    ...(production ? { NODE_ENV: "production" } : {}),
    PORT: String(PORT),
    DB_DIALECT: dialect,
    DATABASE_URL: url,
    NEXTLY_SECRET: SECRET,
    NEXT_PUBLIC_APP_URL: BASE,
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXTLY_SPEED_EXTRA_COLLECTIONS: String(extra),
    NEXTLY_SPEED_DB_DELAY_MS: String(delay),
    ...(log ? { NEXTLY_SPEED_STATEMENT_LOG: log } : {}),
  };
}

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

/** Seeds a run's database and installs the playground's plugins into it. */
function prepare(env) {
  run("pnpm --filter playground exec tsx scripts/seed.ts", env);
  run("pnpm --filter playground exec nextly plugins install --all", env);
}

/** Starts the production server cold, with the preload loaded into it. */
async function startServer(env) {
  const started = Date.now();
  const server = spawn(
    "pnpm",
    ["--filter", "playground", "exec", "next", "start", "-p", String(PORT)],
    {
      cwd: ROOT,
      env: {
        ...env,
        NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import ${PRELOAD}`.trim(),
      },
      detached: true,
    }
  );
  let output = "";
  const onData = chunk => {
    output += chunk;
  };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  while (!(await portOpen(PORT))) {
    if (server.exitCode !== null)
      throw new Error(`the server exited:\n${output.slice(-2000)}`);
    await sleep(25);
  }
  // The port answering is only ours if our server is still running.
  if (server.exitCode !== null)
    throw new Error(`the server exited:\n${output.slice(-2000)}`);
  return {
    started,
    listening: Date.now(),
    output: () => output,
    stop: async () => {
      // The whole process group: `pnpm exec` and the Next.js server under it.
      // No pid means the spawn itself failed, and nothing is running.
      if (server.pid !== undefined) {
        try {
          process.kill(-server.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      await sleep(1000);
    },
  };
}

/**
 * A start: asks for the admin page as soon as the server listens, then waits
 * until no statement has been sent for `START_QUIET_MS`. Returns the
 * statements sent until then and when the page's first byte arrived.
 */
async function startOf(server, log) {
  const firstByte = fetch(`${BASE}/admin`).then(async response => {
    const at = Date.now() - server.listening;
    if (response.status >= 500) {
      throw new Error(
        `the admin answered ${response.status}:\n${server.output().slice(-2000)}`
      );
    }
    await response.arrayBuffer();
    return at;
  });
  const firstByteMs = await firstByte;
  const until = Date.now() + 900_000;
  let count = -1;
  let since = Date.now();
  for (;;) {
    const now = readLog(log).length;
    if (now !== count) {
      count = now;
      since = Date.now();
    } else if (Date.now() - since >= START_QUIET_MS) break;
    if (Date.now() > until) throw new Error("the start never fell quiet");
    await sleep(200);
  }
  return {
    statements: count,
    firstByteMs,
    seconds: Number(((since - server.started) / 1000).toFixed(1)),
  };
}

/** The longest chain of admin requests in which each began after an earlier one ended. */
function roundsOf(requests) {
  const sorted = [...requests].sort((a, b) => a.start - b.start);
  const depth = new Map();
  for (const request of sorted) {
    let d = 1;
    for (const before of sorted) {
      if (
        before !== request &&
        before.end !== undefined &&
        before.end <= request.start
      ) {
        d = Math.max(d, (depth.get(before) ?? 1) + 1);
      }
    }
    depth.set(request, d);
  }
  return Math.max(0, ...depth.values());
}

/** Watches one page's admin requests until none has started for `QUIET_MS`. */
function watch(page) {
  const requests = [];
  let lastStart = Date.now();
  page.on("request", request => {
    // A new document in the tab (a redirect to the sign-in page, say) ends
    // the old one's requests, which then never report an answer.
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      const now = Date.now();
      for (const r of requests) if (r.end === undefined) r.end = now;
    }
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith("/admin/api/") || pathname.endsWith("/dev-reload"))
      return;
    const entry = {
      method: request.method(),
      path: pathname,
      start: Date.now(),
    };
    request.__speed = entry;
    requests.push(entry);
    lastStart = entry.start;
  });
  let lastEnd = Date.now();
  const end = request => {
    if (!request.__speed) return;
    request.__speed.end = Date.now();
    lastEnd = request.__speed.end;
  };
  page.on("requestfinished", end);
  page.on("requestfailed", end);
  // A response whose body the admin never reads (a superseded query) fires
  // neither event above, so its arrival counts as the answer too.
  page.on("response", response => end(response.request()));
  const open = () => requests.some(r => r.end === undefined);
  return {
    requests,
    // Done once every admin request has answered and none has started or
    // answered for `QUIET_MS`. A slow request is waited for, up to
    // `OPEN_WAIT_MS` with nothing else happening; one still open then is
    // marked as never answered (a request of a page the tab has since
    // replaced reports no end at all) and judged by `compare`. A load that
    // keeps starting requests for a minute fails outright.
    async quiet() {
      const until = Date.now() + 60_000;
      for (;;) {
        const idle = Date.now() - Math.max(lastStart, lastEnd);
        if (!open() && idle >= QUIET_MS) break;
        if (open() && idle >= OPEN_WAIT_MS) {
          for (const r of requests)
            if (r.end === undefined)
              Object.assign(r, { end: Date.now(), unanswered: true });
          break;
        }
        if (Date.now() > until)
          throw new Error(
            `a load of ${page.url()} kept sending requests for a minute`
          );
        await sleep(100);
      }
      return Date.now();
    },
  };
}

/**
 * One load: runs `load` on a new page, after `before` where given, until no
 * request has started for `QUIET_MS`, and counts what it cost.
 */
async function sample(context, log, load, before) {
  const page = await context.newPage();
  const watcher = watch(page);
  if (before) {
    // What comes before the counted moment (opening the form, typing) is
    // left out: its requests are dropped once it has fallen quiet.
    await before(page);
    await watcher.quiet();
    watcher.requests.length = 0;
  }
  const from = Date.now();
  const kept = await load(page);
  const to = await watcher.quiet();
  await page.close();
  return {
    kept,
    requests: watcher.requests.length,
    rounds: roundsOf(watcher.requests),
    statements: readLog(log).filter(s => s.t >= from && s.t <= to).length,
    kinds: watcher.requests.map(r => `${r.method} ${kindOf(r.path)}`),
    unanswered: watcher.requests
      .filter(r => r.unanswered)
      .map(r => `${r.method} ${kindOf(r.path)}`),
  };
}

/**
 * A request's kind: its method and path, with ids made generic, since every
 * run seeds its own rows and an entry's id differs from run to run.
 */
function kindOf(pathname) {
  return pathname
    .split("/")
    .map(part =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        part
      ) || /^\d+$/.test(part)
        ? ":id"
        : part
    )
    .join("/");
}

/** How many of each kind of request a load sent. */
function tally(kinds) {
  const counts = {};
  for (const kind of kinds) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

/**
 * The same load `SAMPLES` times. Some requests are sent more often in some
 * loads than others: one sent twice when two parts of a screen race to ask
 * for it, or one a timer fires near the end of a load. So each kind of
 * request counts the fewest times any load sent it, and a kind some loads
 * did not send at all is kept apart as occasional. A request the admin always
 * sends is in every load, so a new one is caught by its kind, and one more of
 * a kind by its number. Rounds and statements are likewise the fewest any load
 * took: a slow answer can add a round to one load, and an extra copy of a
 * request sends its own statements, but a real new step is in every load.
 */
async function steady(context, log, load, { fresh, before } = {}) {
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    const own = fresh ? await fresh() : context;
    samples.push(await sample(own, log, load, before));
    if (fresh) await own.close();
  }
  const tallies = samples.map(x => tally(x.kinds));
  const kinds = {};
  const occasional = [];
  for (const kind of new Set(tallies.flatMap(t => Object.keys(t)))) {
    const fewest = Math.min(...tallies.map(t => t[kind] ?? 0));
    if (fewest > 0) kinds[kind] = fewest;
    else occasional.push(kind);
  }
  const fewestStatements = Math.min(...samples.map(x => x.statements));
  return {
    kept: samples[0].kept,
    result: {
      requests: Object.values(kinds).reduce((a, b) => a + b, 0),
      rounds: Math.min(...samples.map(x => x.rounds)),
      statements: fewestStatements,
      kinds,
      occasional: occasional.sort(),
      unanswered: [...new Set(samples.flatMap(x => x.unanswered))].sort(),
    },
  };
}

/** A full measurement of one dialect: the start and every screen. */
async function measureDialect(dialect, dir) {
  const { database, url } = await freshDatabase(dialect);
  const log = path.join(dir, `${dialect}.statements.jsonl`);
  fs.rmSync(log, { force: true });
  // Everything acquired is released in `finally`, whichever step failed.
  let browser;
  let server;
  const out = { start: {}, screens: {} };
  try {
    prepare(serverEnv(dialect, url));
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    server = await startServer(
      serverEnv(dialect, url, { log, production: true })
    );
    // The start, alone: the admin page is asked for the moment the server
    // listens, which begins a start that only a request begins, and the start
    // is every statement until the database has been quiet for a while, the
    // work it leaves running after Nextly says it has started included.
    const started = await startOf(server, log);
    out.firstByteMs = started.firstByteMs;
    out.start.statements = started.statements;

    const fresh = () =>
      browser.newContext({ viewport: { width: 1440, height: 900 } });
    const emailBox = p => p.getByRole("textbox", { name: /email/i });
    const openForm = async page => {
      await page.goto(`${BASE}/admin`, { timeout: 120_000 });
      await emailBox(page).waitFor({ timeout: 120_000 });
    };
    const signIn = async page => {
      await emailBox(page).fill(USER.email);
      await page
        .getByRole("textbox", { name: /password/i })
        .fill(USER.password);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      await page.locator("main").waitFor({ timeout: 300_000 });
    };

    // The sign-in screen, signed out, on the started server.
    out.screens.login = (
      await steady(context, log, openForm, { fresh })
    ).result;

    // Signing in through the real form, counted from the click.
    out.screens.signin = (
      await steady(context, log, signIn, {
        fresh,
        before: openForm,
      })
    ).result;

    // The signed-in browser whose fresh tabs open the remaining screens.
    const first = await context.newPage();
    await openForm(first);
    await signIn(first);
    await first.close();

    const entryLink =
      'main a[href^="/admin/collections/posts/"]:not([href$="/create"]) >> visible=true';
    out.screens.dashboard = (
      await steady(
        context,
        log,
        async page => {
          await page.goto(`${BASE}/admin`, { timeout: 120_000 });
          await page.locator("main").waitFor({ timeout: 120_000 });
        },
        {}
      )
    ).result;
    const list = await steady(
      context,
      log,
      async page => {
        await page.goto(`${BASE}/admin/collections/posts`, {
          timeout: 120_000,
        });
        await page.locator(entryLink).first().waitFor({ timeout: 120_000 });
        return page.locator(entryLink).first().getAttribute("href");
      },
      {}
    );
    out.screens.list = list.result;
    const href = list.kept;
    out.screens.edit = (
      await steady(
        context,
        log,
        async page => {
          await page.goto(new URL(href, BASE).toString(), { timeout: 120_000 });
          await page.getByRole("textbox").first().waitFor({ timeout: 120_000 });
        },
        {}
      )
    ).result;
  } finally {
    await browser?.close();
    await server?.stop();
    if (database) await dropServerDatabase(database).catch(() => {});
  }
  return out;
}

/** The start alone: its statements, with a delay or extra collections. */
async function measureStart(dialect, dir, { delay = 0, extra = 0, label }) {
  const { database, url } = await freshDatabase(dialect);
  const log = path.join(dir, `${dialect}.${label}.statements.jsonl`);
  fs.rmSync(log, { force: true });
  let server;
  try {
    prepare(serverEnv(dialect, url, { extra }));
    server = await startServer(
      serverEnv(dialect, url, { delay, extra, log, production: true })
    );
    return await startOf(server, log);
  } finally {
    await server?.stop();
    if (database) await dropServerDatabase(database).catch(() => {});
  }
}

/**
 * A count against its pin: over by more than `above` fails, and under by more
 * than `below` asks for the pin to be lowered.
 */
function checkCount(name, value, pin, { above, below }) {
  if (pin === undefined)
    return [`${name}: ${value}, and nothing is pinned for it`];
  if (value > pin + above)
    return [`${name}: ${value}, above its pin of ${pin}`];
  if (value < pin - below)
    return [
      `${name}: ${value}, below its pin of ${pin}; lower the pin (--update-pins)`,
    ];
  return [];
}

/** The allowance of a statement count: a share of its pin, either way. */
function slackOf(pin, share = STATEMENT_SLACK) {
  const slack = pin === undefined ? 0 : Math.ceil(pin * share);
  return { above: slack, below: slack };
}

/**
 * A screen's requests, kind by kind. `racy` holds the kinds this screen is
 * known to send a varying number of times (two parts of it racing to ask for
 * the same thing, or a timer near the end of a load): their number may move,
 * and they may come and go between every load and only some.
 */
function kindProblems(label, values, pin, racy) {
  const problems = [];
  for (const [kind, count] of Object.entries(values.kinds)) {
    const pinned = pin.kinds?.[kind];
    if (pinned === undefined) {
      // A kind once sent only by some loads that every load now sends is a
      // new steady request, unless it is one this screen races on.
      if (!racy.has(kind))
        problems.push(
          `${label}: a new request, ${kind}, sent ${count} time(s) in every load`
        );
    } else if (!racy.has(kind) && count > pinned) {
      problems.push(
        `${label}: ${kind} sent ${count} times in every load, above its pin of ${pinned}`
      );
    } else if (!racy.has(kind) && count < pinned) {
      problems.push(
        `${label}: ${kind} sent ${count} time(s), below its pin of ${pinned}; lower the pin (--update-pins)`
      );
    }
  }
  // A request that never answered is a hang, unless it is one this screen
  // races on and the tab replaced the page that sent it.
  for (const kind of values.unanswered ?? []) {
    if (!racy.has(kind))
      problems.push(
        `${label}: ${kind} never answered within ${OPEN_WAIT_MS / 1000} s`
      );
  }
  // Still sent in some loads is not gone; only a kind no load sent is.
  for (const kind of Object.keys(pin.kinds ?? {})) {
    if (values.kinds[kind] === undefined && !values.occasional.includes(kind))
      problems.push(
        `${label}: ${kind} is no longer sent; lower the pin (--update-pins)`
      );
  }
  return problems;
}

/** One screen against its pin: its requests, rounds and statements. */
function screenProblems(label, values, pin, racy) {
  if (!pin) return [`${label}: nothing is pinned for it`];
  return [
    ...kindProblems(label, values, pin, racy),
    // A round is judged from when requests answered, so one more or fewer
    // can be the machine rather than the change.
    ...checkCount(`${label} rounds`, values.rounds, pin.rounds, {
      above: ROUND_SLACK,
      below: ROUND_SLACK,
    }),
    ...checkCount(
      `${label} statements`,
      values.statements,
      pin.statements,
      slackOf(pin.statements, SCREEN_STATEMENT_SLACK)
    ),
  ];
}

/**
 * How much a delay or more collections add to the start. Growth may only
 * fall, and a start that does a fixed amount of work has none.
 */
function growthProblems(growth, pins) {
  return Object.entries(growth ?? {}).flatMap(([name, value]) => {
    const pin = pins.growth?.[name];
    // A few statements either way, or 5% of a large growth: bound by the
    // growth itself, so a small one cannot hide a new loop behind the size
    // of the whole start.
    const slack = Math.max(
      GROWTH_SLACK_MIN,
      Math.ceil(Math.abs(pin ?? 0) * STATEMENT_SLACK)
    );
    return checkCount(`growth ${name} (statements)`, value, pin, {
      above: slack,
      below: slack,
    });
  });
}

/** Every difference from the pins, as lines naming the number. */
function compare(measured, pins) {
  const racyOf = name => new Set(pins.racy?.[name] ?? []);
  const problems = [];
  for (const dialect of DIALECTS) {
    const m = measured[dialect];
    const p = pins[dialect] ?? {};
    problems.push(
      ...checkCount(
        `${dialect} start statements`,
        m.start.statements,
        p.start?.statements,
        slackOf(p.start?.statements)
      )
    );
    for (const [name, values] of Object.entries(m.screens))
      problems.push(
        ...screenProblems(
          `${dialect} ${name}`,
          values,
          p.screens?.[name],
          racyOf(name)
        )
      );
  }
  return [
    ...problems,
    ...growthProblems(measured.growth, pins),
    ...firstByteProblems(measured.delayed),
  ];
}

/** The admin page's first byte on the delayed start, against its limit. */
function firstByteProblems(delayed) {
  if (delayed === undefined || delayed.firstByteMs <= FIRST_BYTE_LIMIT_MS)
    return [];
  return [
    `admin page first byte with ${DELAY_MS} ms per round trip: ${delayed.firstByteMs} ms, above its limit of ${FIRST_BYTE_LIMIT_MS} ms`,
  ];
}

async function main() {
  if (await portOpen(PORT)) {
    throw new Error(
      `port ${PORT} is already in use; stop what listens there, or set ADMIN_SPEED_PORT to a free one`
    );
  }
  const dir = path.join(ROOT, "e2e", ".playwright", "admin-speed");
  fs.mkdirSync(dir, { recursive: true });
  if (flag("build")) {
    // The build prerenders pages that read the database, so it is given a
    // seeded one, as the production browser suite seeds before it builds.
    // The playground stubs out the MySQL driver in a build made for any other
    // dialect, so one build serves all three only when it is made on MySQL.
    const buildDialect = DIALECTS.includes("mysql") ? "mysql" : DIALECTS[0];
    const { database, url } = await freshDatabase(buildDialect);
    const buildEnv = serverEnv(buildDialect, url);
    try {
      prepare(buildEnv);
      run("pnpm --filter playground exec next build", buildEnv);
    } finally {
      if (database) await dropServerDatabase(database).catch(() => {});
    }
  }

  const measured = {};
  for (const dialect of DIALECTS) {
    console.log(`\n[admin-speed] ${dialect}`);
    measured[dialect] = await measureDialect(dialect, dir);
    console.log(JSON.stringify(measured[dialect]));
  }
  if (DIALECTS.includes("postgresql") && !flag("no-growth")) {
    const plain = measured.postgresql.start.statements;
    const delayed = await measureStart("postgresql", dir, {
      delay: DELAY_MS,
      label: "delay",
    });
    const extra = await measureStart("postgresql", dir, {
      extra: EXTRA_COLLECTIONS,
      label: "extra",
    });
    measured.growth = {
      [`withDelay${DELAY_MS}ms`]: delayed.statements - plain,
      [`with${EXTRA_COLLECTIONS}MoreCollections`]: extra.statements - plain,
    };
    measured.delayed = delayed;
    console.log(
      `[admin-speed] delay ${DELAY_MS} ms: ${JSON.stringify(delayed)}`
    );
    console.log(
      `[admin-speed] ${EXTRA_COLLECTIONS} more collections: ${JSON.stringify(extra)}`
    );
  }

  const json = option("json");
  if (json) fs.writeFileSync(json, `${JSON.stringify(measured, null, 2)}\n`);

  const pins = fs.existsSync(PINS_FILE)
    ? JSON.parse(fs.readFileSync(PINS_FILE, "utf8"))
    : {};
  if (flag("update-pins")) {
    const next = { ...pins };
    for (const dialect of DIALECTS)
      next[dialect] = {
        start: measured[dialect].start,
        screens: measured[dialect].screens,
      };
    if (measured.growth) next.growth = measured.growth;
    fs.writeFileSync(PINS_FILE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `[admin-speed] pins written to ${path.relative(ROOT, PINS_FILE)}`
    );
    return;
  }
  const problems = compare(measured, pins);
  if (problems.length > 0) {
    console.error(
      `\n[admin-speed] ${problems.length} count(s) differ from their pins:\n- ${problems.join("\n- ")}`
    );
    process.exitCode = 1;
  } else {
    console.log("\n[admin-speed] every count is within its pin");
  }
}

await main();
