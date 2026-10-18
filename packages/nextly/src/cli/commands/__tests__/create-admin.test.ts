/**
 * `nextly users:create-admin`: the first administrator is created under the
 * setup claim and only while nobody is administrator, the password comes from
 * the environment or a prompt and is held to setup's rules, and there is no
 * password argument. The database steps are covered on every dialect in
 * `create-admin.integration.test.ts`.
 */
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import type { CommandContext } from "../../program";
import {
  ADMIN_PASSWORD_ENV,
  CREATE_ADMIN_COMMAND,
  createFirstAdministrator,
  readAdminPassword,
  registerCreateAdminCommand,
  runCreateAdmin,
  type CreateAdminIo,
  type FirstAdminSetup,
} from "../create-admin";

const STRONG = "Correct-Horse-Battery-9";

const DETAILS = { email: "ada@example.com", name: "Ada", password: STRONG };

/** A setup whose every step is recorded, in order. */
function recordingSetup(
  over: Partial<FirstAdminSetup> = {}
): FirstAdminSetup & { steps: string[] } {
  const steps: string[] = [];
  return {
    steps,
    claim: vi.fn(async () => {
      steps.push("claim");
      return { release: () => void steps.push("release") };
    }),
    administratorExists: vi.fn(async () => {
      steps.push("check");
      return false;
    }),
    accountExists: vi.fn(async () => {
      steps.push("email");
      return false;
    }),
    createAdministrator: vi.fn(async () => {
      steps.push("create");
      return "created" as const;
    }),
    spendSetupToken: vi.fn(async () => void steps.push("spend")),
    ...over,
  };
}

function context(): CommandContext & {
  logger: {
    error: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
  };
} {
  return {
    logger: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() },
    options: {},
    cwd: "/app",
  } as unknown as CommandContext & {
    logger: {
      error: ReturnType<typeof vi.fn>;
      success: ReturnType<typeof vi.fn>;
    };
  };
}

function io(over: Partial<CreateAdminIo> = {}): CreateAdminIo & {
  connect: ReturnType<typeof vi.fn>;
} {
  const setup = recordingSetup();
  return {
    env: {},
    interactive: false,
    askSecret: vi.fn(async () => null),
    ask: vi.fn(async () => null),
    connect: vi.fn(async () => ({ setup, close: async () => undefined })),
    ...over,
  } as CreateAdminIo & { connect: ReturnType<typeof vi.fn> };
}

describe("createFirstAdministrator", () => {
  it("creates the administrator under the claim, then spends the setup token, then releases", async () => {
    const setup = recordingSetup();
    expect(await createFirstAdministrator(setup, DETAILS)).toBe("created");
    expect(setup.steps).toEqual([
      "claim",
      "check",
      "email",
      "create",
      "spend",
      "release",
    ]);
    expect(setup.createAdministrator).toHaveBeenCalledWith(DETAILS);
  });

  it("refuses, creating nothing, once an administrator exists", async () => {
    const setup = recordingSetup({
      administratorExists: vi.fn(async () => true),
    });
    expect(await createFirstAdministrator(setup, DETAILS)).toBe(
      "administrator-exists"
    );
    expect(setup.createAdministrator).not.toHaveBeenCalled();
    expect(setup.spendSetupToken).not.toHaveBeenCalled();
    expect(setup.steps).toContain("release");
  });

  it("refuses, creating nothing, an email that already belongs to an account", async () => {
    const setup = recordingSetup({ accountExists: vi.fn(async () => true) });
    expect(await createFirstAdministrator(setup, DETAILS)).toBe("email-in-use");
    expect(setup.accountExists).toHaveBeenCalledWith(DETAILS.email);
    expect(setup.createAdministrator).not.toHaveBeenCalled();
    expect(setup.spendSetupToken).not.toHaveBeenCalled();
    expect(setup.steps.at(-1)).toBe("release");
  });

  it("refuses, asking nothing more, while another setup holds the claim", async () => {
    const setup = recordingSetup({ claim: vi.fn(async () => null) });
    expect(await createFirstAdministrator(setup, DETAILS)).toBe(
      "setup-in-progress"
    );
    expect(setup.administratorExists).not.toHaveBeenCalled();
    expect(setup.createAdministrator).not.toHaveBeenCalled();
  });

  it.each(["administrator-exists", "email-in-use"] as const)(
    "reports creation's own refusal (%s), spending no token",
    async refusal => {
      // The checks passed, and creation still refused: an administrator or
      // an account appeared between them and the insert.
      const setup = recordingSetup({
        createAdministrator: vi.fn(async () => refusal),
      });
      expect(await createFirstAdministrator(setup, DETAILS)).toBe(refusal);
      expect(setup.spendSetupToken).not.toHaveBeenCalled();
      expect(setup.steps.at(-1)).toBe("release");
    }
  );

  it("releases the claim when creating fails", async () => {
    const setup = recordingSetup({
      createAdministrator: vi.fn(async () => {
        throw new Error("database went away");
      }),
    });
    await expect(createFirstAdministrator(setup, DETAILS)).rejects.toThrow(
      "database went away"
    );
    expect(setup.steps.at(-1)).toBe("release");
    expect(setup.spendSetupToken).not.toHaveBeenCalled();
  });
});

describe("readAdminPassword", () => {
  it("takes the environment variable without asking", async () => {
    const asked = io({
      env: { [ADMIN_PASSWORD_ENV]: STRONG },
      interactive: true,
    });
    expect(await readAdminPassword(asked)).toBe(STRONG);
    expect(asked.askSecret).not.toHaveBeenCalled();
  });

  it("asks twice at a terminal, and takes the answer when both agree", async () => {
    const asked = io({
      interactive: true,
      askSecret: vi.fn(async () => STRONG),
    });
    expect(await readAdminPassword(asked)).toBe(STRONG);
    expect(asked.askSecret).toHaveBeenCalledTimes(2);
  });

  it("answers undefined when the two answers differ", async () => {
    const answers = [STRONG, `${STRONG}x`];
    const asked = io({
      interactive: true,
      askSecret: vi.fn(async () => answers.shift() ?? null),
    });
    expect(await readAdminPassword(asked)).toBeUndefined();
  });

  it("answers null with no variable and no terminal to ask at", async () => {
    expect(await readAdminPassword(io())).toBeNull();
  });
});

describe("runCreateAdmin", () => {
  it("creates the administrator from flags and the environment", async () => {
    const ctx = context();
    const run = io({ env: { [ADMIN_PASSWORD_ENV]: STRONG } });
    const code = await runCreateAdmin(
      { email: DETAILS.email, name: DETAILS.name },
      ctx,
      run
    );
    expect(code).toBe(0);
    expect(ctx.logger.success).toHaveBeenCalledWith(
      expect.stringContaining(DETAILS.email)
    );
  });

  it("refuses a weak password before connecting", async () => {
    const ctx = context();
    const run = io({ env: { [ADMIN_PASSWORD_ENV]: "short" } });
    const code = await runCreateAdmin(
      { email: DETAILS.email, name: DETAILS.name },
      ctx,
      run
    );
    expect(code).toBe(1);
    expect(ctx.logger.error).toHaveBeenCalledWith("That password is too weak:");
    expect(run.connect).not.toHaveBeenCalled();
  });

  it("names the variable when no password can be had, and connects to nothing", async () => {
    const ctx = context();
    const run = io();
    const code = await runCreateAdmin(
      { email: DETAILS.email, name: DETAILS.name },
      ctx,
      run
    );
    expect(code).toBe(1);
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringContaining(ADMIN_PASSWORD_ENV)
    );
    expect(run.connect).not.toHaveBeenCalled();
  });

  it("refuses an email that is not one", async () => {
    const ctx = context();
    const run = io({ env: { [ADMIN_PASSWORD_ENV]: STRONG } });
    expect(
      await runCreateAdmin({ email: "not-an-email", name: "Ada" }, ctx, run)
    ).toBe(1);
    expect(run.connect).not.toHaveBeenCalled();
  });

  it("reports setup as complete, with a failing code, when an administrator exists", async () => {
    const ctx = context();
    const setup = recordingSetup({
      administratorExists: vi.fn(async () => true),
    });
    const run = io({
      env: { [ADMIN_PASSWORD_ENV]: STRONG },
      connect: vi.fn(async () => ({ setup, close: async () => undefined })),
    });
    expect(
      await runCreateAdmin(
        { email: DETAILS.email, name: DETAILS.name },
        ctx,
        run
      )
    ).toBe(1);
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Setup is already complete")
    );
  });
});

describe("the registered command", () => {
  function program(): Command {
    const root = new Command().exitOverride();
    registerCreateAdminCommand(root, () => context());
    return root;
  }

  it("takes no password argument", () => {
    const command = program().commands.find(
      c => c.name() === CREATE_ADMIN_COMMAND
    );
    expect(command?.options.map(option => option.long)).toEqual([
      "--email",
      "--name",
    ]);
  });

  it("refuses --password as an unknown option", async () => {
    const root = program();
    root.commands.forEach(c =>
      c.exitOverride().configureOutput({ writeErr: () => undefined })
    );
    await expect(
      root.parseAsync(
        ["node", "nextly", CREATE_ADMIN_COMMAND, "--password", STRONG],
        { from: "node" }
      )
    ).rejects.toThrow(/unknown option/);
  });
});
