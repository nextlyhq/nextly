/**
 * The connection string is a secret. Given with `--database-url <url>` or on
 * standard input (`--database-url -`), it lands only in the ignored `.env`,
 * the example file keeps a placeholder, and no user name, password or query
 * parameter from it is printed or passed to any command the scaffold runs.
 */
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectionSecrets,
  holdsCredentials,
  redactConnection,
} from "../lib/connection-string";

import { ui } from "./clack-recorder";
import {
  type FakeRun,
  HERMETIC,
  USER_AGENTS,
  captureConsole,
  installFakeManagers,
  makeWorkdir,
  printed,
  runCli,
} from "./scaffold-harness";

vi.mock("@clack/prompts", async () =>
  (await import("./clack-recorder")).clack()
);
vi.mock("@nextlyhq/telemetry", async () =>
  (await import("./clack-recorder")).telemetry()
);

const USER = "scaffold_user";
const PASSWORD = "S3cr3t-Pa55";
const QUERY_SECRET = "Qu3ry-S3cret";
const URL_WITH_SECRETS = `postgresql://${USER}:${PASSWORD}@db.example.com:5432/app?sslpassword=${QUERY_SECRET}`;
const SECRETS = [USER, PASSWORD, QUERY_SECRET];

let dir: string;
let work: string;
let fakes: FakeRun;

beforeEach(async () => {
  ui.reset();
  captureConsole();
  dir = await makeWorkdir("nextly-url-secret-");
  work = path.join(dir, "work");
  await mkdir(work);
  fakes = await installFakeManagers(dir);
  vi.stubEnv("npm_config_user_agent", USER_AGENTS.pnpm);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const allOutput = () => [...ui.out, ...printed].join("\n");

/** Every file under `root` but `.env`, which holds the real values. */
async function filesOtherThanEnv(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root)) {
    const file = path.join(root, entry);
    if ((await stat(file)).isDirectory()) {
      if (entry === "node_modules") continue;
      found.push(...(await filesOtherThanEnv(file)));
    } else if (!(root === path.join(work, "my-app") && entry === ".env")) {
      found.push(file);
    }
  }
  return found;
}

async function expectKeptSecret(project: string): Promise<void> {
  // In the ignored env file, as given.
  expect(await readFile(path.join(project, ".env"), "utf-8")).toContain(
    `DATABASE_URL=${URL_WITH_SECRETS}`
  );
  const ignored = (await readFile(path.join(project, ".gitignore"), "utf-8"))
    .split(/\r?\n/)
    .map(line => line.trim());
  expect(ignored).toContain(".env");
  // A placeholder in the example file.
  expect(await readFile(path.join(project, ".env.example"), "utf-8")).toMatch(
    /DATABASE_URL=postgres(ql)?:\/\/.*localhost/
  );
  // Nowhere else: no other file, nothing printed, no command's arguments.
  for (const file of await filesOtherThanEnv(project)) {
    const text = await readFile(file, "utf-8").catch(() => "");
    for (const secret of SECRETS) expect(text, file).not.toContain(secret);
  }
  const said = allOutput();
  for (const secret of SECRETS) expect(said).not.toContain(secret);
  const commands = JSON.stringify(await fakes.calls());
  for (const secret of SECRETS) expect(commands).not.toContain(secret);
}

const FLAGS = ["my-app", "-t", "blank", "-d", "postgresql", "--yes"];

describe("the connection string is kept secret", () => {
  it("given as --database-url <url>: in .env only, printed nowhere", async () => {
    const code = await runCli(
      [...FLAGS, "--database-url", URL_WITH_SECRETS, ...HERMETIC],
      { cwd: work }
    );

    expect(code).toBe(0);
    await expectKeptSecret(path.join(work, "my-app"));
    // And the run says how to keep it out of the command line next time.
    expect(allOutput()).toContain("--database-url -");
  });

  it("given on standard input (--database-url -): absent from the arguments too", async () => {
    const args = [...FLAGS, "--database-url", "-", ...HERMETIC];

    const code = await runCli(args, {
      cwd: work,
      stdin: `${URL_WITH_SECRETS}\n`,
    });

    expect(code).toBe(0);
    for (const secret of SECRETS) {
      expect(args.join(" ")).not.toContain(secret);
    }
    await expectKeptSecret(path.join(work, "my-app"));
    expect(allOutput()).not.toContain("went through the command line");
  });

  it("an error that quotes the connection string prints only its safe form", async () => {
    vi.stubEnv("FAKE_PM_FAIL_WITH", URL_WITH_SECRETS);

    const code = await runCli(
      [...FLAGS, "--database-url", URL_WITH_SECRETS, ...HERMETIC],
      { cwd: work }
    );

    expect(code).toBe(1);
    const said = allOutput();
    expect(said).toContain("install failed: postgresql://***@db.example.com");
    for (const secret of SECRETS) expect(said).not.toContain(secret);
  });

  it("a URL for another database than --database is refused, nothing written", async () => {
    const code = await runCli(
      [
        "my-app",
        "-d",
        "mysql",
        "--yes",
        "--database-url",
        URL_WITH_SECRETS,
        ...HERMETIC,
      ],
      { cwd: work }
    );

    expect(code).toBe(1);
    expect(await readdir(work)).toEqual([]);
    expect(allOutput()).toContain(
      "is a postgresql connection string, but --database is mysql"
    );
    for (const secret of SECRETS) expect(allOutput()).not.toContain(secret);
  });

  it("a URL without --database is refused, naming the flag", async () => {
    const code = await runCli(
      ["my-app", "--yes", "--database-url", URL_WITH_SECRETS, ...HERMETIC],
      { cwd: work }
    );

    expect(code).toBe(1);
    expect(await readdir(work)).toEqual([]);
    expect(allOutput()).toContain("Pass -d postgresql");
  });

  it("--database-url - with nothing on standard input is refused, nothing written", async () => {
    const code = await runCli([...FLAGS, "--database-url", "-", ...HERMETIC], {
      cwd: work,
      stdin: "",
    });

    expect(code).toBe(1);
    expect(await readdir(work)).toEqual([]);
    expect(allOutput()).toContain("read nothing from standard input");
  });

  it("asked at a terminal, the connection string prompt is masked", async () => {
    ui.answers.password = URL_WITH_SECRETS;

    const code = await runCli(
      ["my-app", "-t", "blank", "-d", "postgresql", ...HERMETIC],
      { cwd: work, tty: true }
    );

    expect(code).toBe(0);
    expect(ui.asked).toEqual([
      expect.stringMatching(/^password: .*PostgreSQL connection string/),
    ]);
    await expectKeptSecret(path.join(work, "my-app"));
  });
});

describe("scrubbing printed text", () => {
  it("masks the URL, the user name, the password and every query value", () => {
    const message = `connect to ${URL_WITH_SECRETS} failed for user "${USER}" (password ${PASSWORD}, sslpassword=${QUERY_SECRET})`;

    const scrubbed = redactConnection(message, URL_WITH_SECRETS);

    for (const secret of SECRETS) expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain("db.example.com");
  });

  it("masks percent-encoded credentials in both spellings", () => {
    const url = "mysql://us%40er:p%40ss%21word@localhost/app";
    const scrubbed = redactConnection(
      "us@er p@ss!word us%40er p%40ss%21word",
      url
    );
    expect(scrubbed).not.toMatch(/us@er|p@ss!word|us%40er|p%40ss%21word/);
    expect(connectionSecrets(undefined)).toEqual([]);
  });

  it("masks a password holding an unencoded @, and one no URL parser reads", () => {
    const withAt = "mysql://root:p@ss@localhost/db";
    expect(
      redactConnection("Access denied for root:p@ss@localhost", withAt)
    ).not.toMatch(/p@ss|ss@/);
    const unparsable = "postgresql://admin:pa#ss/wd@db.example.com/app";
    const said = redactConnection(
      'auth failed for "admin" with pa#ss/wd',
      unparsable
    );
    expect(said).not.toContain("admin");
    expect(said).not.toContain("pa#ss/wd");
    expect(redactConnection(unparsable, unparsable)).toBe(
      "postgresql://***@db.example.com/app"
    );
  });

  it("masks a fragment only where it stands alone, so messages stay readable", () => {
    const url =
      "postgresql://postgres:pw-secret@localhost:5432/app?sslmode=require";
    expect(redactConnection(`connect to ${url}`, url)).toBe(
      "connect to postgresql://***@localhost:5432/app?***"
    );
    expect(redactConnection('SSL is required for user "postgres"', url)).toBe(
      'SSL is required for user "***"'
    );
  });

  it("knows a URL with no credentials from one with them", () => {
    expect(holdsCredentials("postgresql://localhost:5432/app")).toBe(false);
    expect(holdsCredentials(URL_WITH_SECRETS)).toBe(true);
    expect(holdsCredentials("not a url")).toBe(true);
  });
});
