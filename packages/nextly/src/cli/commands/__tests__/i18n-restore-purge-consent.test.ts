/**
 * `nextly i18n:restore --purge` deletes the replayed rows from the
 * translation archive, so it takes the data-loss consent: with none and no
 * terminal it changes nothing, not even the restore, and names the consent; at
 * a terminal it asks, and a no changes nothing. A restore without `--purge`
 * deletes nothing and asks nothing.
 *
 * The restore is faked: whether it ran, and with `purge`, is what the command
 * decided.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import type { CommandContext } from "../../context";
import { runI18nRestore } from "../i18n-restore";

const restore = vi.hoisted(() =>
  vi.fn(async (_args: { purge?: boolean }) => ({
    rowsRead: 2,
    rowsRestored: 2,
    rowsClaimed: 0,
    rowsUnattributed: 0,
    locales: ["fr"],
  }))
);
const confirm = vi.hoisted(() => vi.fn(async () => false));

vi.mock("@clack/prompts", () => ({
  confirm,
  isCancel: () => false,
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: ":memory:",
    errors: [],
  }),
  withAdapter: async (work: (adapter: unknown) => Promise<void>) => work({}),
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => ({ config: { db: {} } }),
}));

vi.mock("../../../domains/schema/ui-schema/loader", () => ({
  loadUiSchema: async () => ({}),
}));

vi.mock("../../../domains/i18n/migration/resolve-entity-table", () => ({
  KIND_NAMES: { collection: "collection" },
  kindOption: (kind: string) => kind,
  resolveEntityTables: () => [
    { kind: "collection", companionTableName: "dc_posts_locales" },
  ],
  chooseRestoreEntity: (_slug: string, matches: unknown[]) => ({
    entity: matches[0],
  }),
}));

vi.mock("../../../domains/i18n/migration/restore-archive", () => ({
  restoreI18nArchive: restore,
}));

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

function capture() {
  const lines: string[] = [];
  const push = (m: string) => lines.push(m);
  const logger = {
    info: push,
    warn: push,
    error: push,
    success: push,
    keyValue: () => {},
    getOptions: () => ({ noColor: true }),
  };
  return { lines, context: { logger } as unknown as CommandContext };
}

/** Runs the command; its error, when it ends with one, is returned rather than thrown. */
async function run(options: Record<string, unknown>) {
  const { lines, context } = capture();
  const failure = await runI18nRestore(
    { collection: "posts", ...options },
    context
  ).then(
    () => undefined,
    (error: unknown) =>
      error as { code?: string; what?: string; why?: string; next?: string }
  );
  return { failure, output: lines.join("\n") };
}

// A test worker's streams carry no `isTTY` of their own, so each run sets it
// and the original descriptor is put back after.
const ttyDescriptors = {
  stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
  stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
};

/** Sets both ends of the run to terminals, or not, until `restoreTerminal`. */
function terminal(attached: boolean) {
  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", {
      value: attached,
      configurable: true,
    });
  }
}

function restoreTerminal() {
  for (const [stream, was] of [
    [process.stdin, ttyDescriptors.stdin],
    [process.stdout, ttyDescriptors.stdout],
  ] as const) {
    if (was) Object.defineProperty(stream, "isTTY", was);
    else delete (stream as { isTTY?: boolean }).isTTY;
  }
}

describe("i18n:restore --purge and the data-loss consent", () => {
  let saved: { consent?: string; ci?: string };

  beforeEach(() => {
    restore.mockClear();
    confirm.mockClear();
    saved = {
      consent: process.env.NEXTLY_ACCEPT_DATA_LOSS,
      ci: process.env.CI,
    };
    delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    delete process.env.CI;
    terminal(false);
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Exited(code === undefined ? undefined : Number(code));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreTerminal();
    setNonInteractive(false);
    for (const [name, value] of [
      ["NEXTLY_ACCEPT_DATA_LOSS", saved.consent],
      ["CI", saved.ci],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("restores without --purge, asking nothing", async () => {
    terminal(true);
    const { failure } = await run({});
    expect(failure).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("changes nothing with no terminal and no consent, naming the consent", async () => {
    const { failure } = await run({ purge: true });
    expect(restore).not.toHaveBeenCalled();
    expect(failure?.code).toBe("DATA_LOSS_CONSENT_REQUIRED");
    expect(failure?.next).toContain("--accept-data-loss");
  });

  it("does not ask a terminal under --non-interactive", async () => {
    terminal(true);
    setNonInteractive(true);
    const { failure } = await run({ purge: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(failure?.code).toBe("DATA_LOSS_CONSENT_REQUIRED");
  });

  it("purges with --accept-data-loss", async () => {
    const { failure } = await run({ purge: true, acceptDataLoss: true });
    expect(failure).toBeUndefined();
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ purge: true })
    );
  });

  it("purges with NEXTLY_ACCEPT_DATA_LOSS naming the archive", async () => {
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "nextly_i18n_archive";
    const { failure } = await run({ purge: true });
    expect(failure).toBeUndefined();
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ purge: true })
    );
  });

  it("asks at a terminal, and changes nothing on a no, naming the consent", async () => {
    terminal(true);
    const { failure } = await run({ purge: true });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
    expect(failure?.what).toContain("the deletion was not confirmed");
    expect(failure?.next).toContain("--accept-data-loss");
  });

  it("purges on a yes at the terminal", async () => {
    terminal(true);
    confirm.mockResolvedValueOnce(true);
    const { failure } = await run({ purge: true });
    expect(failure).toBeUndefined();
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ purge: true })
    );
  });
});
