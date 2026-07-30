/**
 * Self-registration gets the same post-commit webhook hooks as every other
 * user write path.
 *
 * `registerUser` builds its own `UsersService` rather than taking the one DI
 * registered, so the drain and retention runner wired at those registration
 * sites do not reach it on their own. An install that relies on Next's
 * `after()` fast path instead of an external scheduled drain would leave the
 * `user.created` event a registration produced sitting unfanned in the outbox.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../../di/container";
import type { Logger } from "../../../../services/shared";
import { AuthService } from "../auth-service";

const constructedWith: unknown[][] = [];

vi.mock("../../../../services/users", () => ({
  UsersService: class {
    constructor(...args: unknown[]) {
      constructedWith.push(args);
    }
    createLocalUser() {
      return Promise.resolve({ id: "u1", email: "a@b.test", name: "A" });
    }
  },
}));

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Enough of an adapter for the service base to construct. */
const adapter = {
  getDialect: () => "sqlite",
  getDb: () => ({}),
} as never;

const scheduler = { offer: vi.fn() };

describe("registerUser webhook write-path hooks", () => {
  beforeEach(() => {
    constructedWith.length = 0;
    container.register("webhookFastDrainScheduler", () => scheduler);
    container.register("config", () => ({
      webhookRetention: { events: { maxAgeDays: 7 } },
    }));
  });

  afterEach(() => {
    container.clear();
    vi.clearAllMocks();
  });

  it("builds the user service with the drain and retention runner", async () => {
    const auth = new AuthService(adapter, silentLogger);

    await auth.registerUser({
      email: "a@b.test",
      name: "A",
      password: "Str0ng-Passw0rd!",
    });

    // Positional, matching the constructor: userConfig, userExtSchemaService
    // and emailService are not this path's to supply, but the two hooks are.
    const args = constructedWith.at(-1) ?? [];
    expect(args[5]).toBe(scheduler);
    expect(args[6]).toBeDefined();
  });
});
