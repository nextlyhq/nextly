import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { HookRegistry } from "../../../hooks/hook-registry";
import type { InTransactionRunner } from "../../../hooks/types";

const declared = vi.hoisted(() => ({
  answer: (_locale?: string): Promise<unknown> => Promise.resolve(undefined),
}));

vi.mock("../public-address", async importOriginal => ({
  ...(await importOriginal<typeof import("../public-address")>()),
  declaredFor: (_type: unknown, locale?: string) => declared.answer(locale),
}));
vi.mock("../held-addresses", async importOriginal => ({
  ...(await importOriginal<typeof import("../held-addresses")>()),
  addressLanguages: () => ["en", "fr"],
  readEveryLanguage: () => Promise.resolve(new Map()),
  heldIn: () => Promise.resolve([{ locale: "fr", path: "/recettes/soupe" }]),
}));

import { startAddressPhase } from "../address-phase";
import { addParticipant, removeParticipant } from "../participants";

/** A registry that hands back the handler core registers. */
function capturingRegistry() {
  const handlers: InTransactionRunner[] = [];
  const registry = {
    registerInTransaction: (_: string, runner: InTransactionRunner) => {
      handlers.push(runner);
    },
    unregisterInTransaction: (_: string, runner: InTransactionRunner) => {
      const at = handlers.indexOf(runner);
      if (at !== -1) handlers.splice(at, 1);
    },
  } as unknown as HookRegistry;
  return { registry, handlers };
}

const participant = {
  holderOf: vi.fn(() => Promise.resolve(null)),
  record: vi.fn(() => Promise.resolve()),
};
const tx = { getDrizzle: () => ({}) } as unknown as TransactionContext;
const write = {
  collection: "recipes",
  operation: "update" as const,
  id: "1",
  data: { title: "Soup" },
  context: {},
};

afterEach(() => {
  removeParticipant(participant);
  vi.clearAllMocks();
});

describe("core's question on a save", () => {
  it("fails the save where reading the type's address fails", async () => {
    const { registry, handlers } = capturingRegistry();
    startAddressPhase(registry);
    addParticipant(participant, "plugin:test");
    const broken = new Error("connection reset");
    declared.answer = () => Promise.reject(broken);

    await expect(handlers[0]?.(tx, write)).rejects.toBe(broken);
  });

  it("skips a collection no configuration or registry names", async () => {
    const { registry, handlers } = capturingRegistry();
    startAddressPhase(registry);
    addParticipant(participant, "plugin:test");
    declared.answer = () =>
      Promise.reject(NextlyError.notFound({ logContext: {} }));

    await expect(handlers[0]?.(tx, write)).resolves.toBeUndefined();
    expect(participant.holderOf).not.toHaveBeenCalled();
  });

  it("asks about a type whose address exists in one language only", async () => {
    const { registry, handlers } = capturingRegistry();
    startAddressPhase(registry);
    addParticipant(participant, "plugin:test");
    declared.answer = locale =>
      Promise.resolve(
        locale === "fr"
          ? { template: "/recettes/{slug}", pathFields: [] }
          : undefined
      );

    await handlers[0]?.(tx, write);

    expect(participant.holderOf).toHaveBeenCalled();
    expect(participant.record).toHaveBeenCalled();
  });
});
