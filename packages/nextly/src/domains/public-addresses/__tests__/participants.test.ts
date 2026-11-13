import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addParticipant,
  addressHeldError,
  firstHolder,
  hasParticipants,
  onParticipantsChange,
  participatingOwners,
  recordEverywhere,
  removeParticipant,
  type AddressHolder,
  type HeldAddress,
  type HeldAddressUpdate,
  type ParticipantRunner,
} from "../participants";

const tx = {} as TransactionContext;
/** One question's identity, as core hands it to every call of the question. */
const key = Object.freeze({});
const post: AddressHolder = { collection: "posts", id: "p1" };
const page: AddressHolder = { collection: "pages", id: "1", label: "Hello" };
const en: HeldAddress = { locale: "en", path: "/blog/hello" };
const fr: HeldAddress = { locale: "fr", path: "/blog/bonjour" };

/** A participant that answers from `held` and remembers what it was told. */
function fake(held: Map<string, AddressHolder> = new Map()) {
  const asked: { address: HeldAddress; batch: readonly HeldAddressUpdate[] }[] =
    [];
  const recorded: (readonly HeldAddressUpdate[])[] = [];
  const runner: ParticipantRunner = {
    async holderOf(address, asker, batch) {
      asked.push({ address, batch });
      const holder = held.get(`${address.locale}|${address.path}`);
      return holder ?? null;
    },
    async record(batch) {
      recorded.push(batch);
    },
  };
  return { runner, asked, recorded };
}

const added: ParticipantRunner[] = [];
function join(runner: ParticipantRunner): void {
  addParticipant(runner, "plugin:test");
  added.push(runner);
}

afterEach(() => {
  for (const runner of added.splice(0)) removeParticipant(runner);
});

describe("the question participants share", () => {
  it("asks every participant about every address, in order", async () => {
    const quiet = fake();
    const holding = fake(new Map([["fr|/blog/bonjour", page]]));
    join(quiet.runner);
    join(holding.runner);
    const update = { holder: post, holds: [en, fr] };

    const clash = await firstHolder(update, [update], tx, key);

    expect(clash).toEqual({ address: fr, heldBy: page });
    expect(quiet.asked.map(a => a.address)).toEqual([en, fr]);
    expect(holding.asked.map(a => a.address)).toEqual([en, fr]);
  });

  it("is no clash where a participant names the asker itself", async () => {
    join(
      fake(new Map([["en|/blog/hello", { ...post, label: "Mine" }]])).runner
    );
    const update = { holder: post, holds: [en] };

    expect(await firstHolder(update, [update], tx, key)).toBeNull();
  });

  it("hands each participant the whole batch", async () => {
    const one = fake();
    join(one.runner);
    const update = { holder: post, holds: [en] };
    const other = { holder: page, holds: [] };

    await firstHolder(update, [update, other], tx, key);

    expect(one.asked[0]?.batch).toEqual([update, other]);
  });

  it("records with every participant", async () => {
    const one = fake();
    const two = fake();
    join(one.runner);
    join(two.runner);
    const batch = [{ holder: post, holds: [en] }];

    await recordEverywhere(batch, tx, key);

    expect(one.recorded).toEqual([batch]);
    expect(two.recorded).toEqual([batch]);
  });

  it("a throwing participant fails the question", async () => {
    const broken = new Error("store unreachable");
    join({
      holderOf: () => Promise.reject(broken),
      record: () => Promise.resolve(),
    });
    const update = { holder: post, holds: [en] };

    await expect(firstHolder(update, [update], tx, key)).rejects.toBe(broken);
  });

  it("knows whether anyone takes part, and says when that changes", () => {
    const counts: number[] = [];
    const stop = onParticipantsChange(count => counts.push(count));
    const one = fake();

    expect(hasParticipants()).toBe(false);
    addParticipant(one.runner, "plugin:test");
    expect(hasParticipants()).toBe(true);
    removeParticipant(one.runner);
    stop();

    expect(hasParticipants()).toBe(false);
    expect(counts).toEqual([1, 0]);
  });
});

describe("the refusal", () => {
  it("names the address and language, and keeps the holder out of the message", () => {
    const error = addressHeldError(
      { holder: post, holds: [en] },
      { address: en, heldBy: page }
    );

    expect(error.code).toBe("DUPLICATE");
    expect(error.publicMessage).toBe(
      "/blog/hello (en) is already the address of another page. Choose another address for this entry."
    );
    // Who holds it is for the log: the saver may not be allowed to read it.
    expect(error.logContext).toMatchObject({ heldBy: page });
  });

  it("says the same whether or not the holder has a label", () => {
    const error = addressHeldError(
      { holder: post, holds: [en] },
      { address: en, heldBy: { collection: "pages", id: "1" } }
    );

    expect(error.publicMessage).toBe(
      "/blog/hello (en) is already the address of another page. Choose another address for this entry."
    );
  });
});

describe("one list per process", () => {
  it("is the same list however many times the module is evaluated", async () => {
    vi.resetModules();
    const first = await import("../participants");
    vi.resetModules();
    const second = await import("../participants");
    const runner = fake().runner;

    first.addParticipant(runner, "plugin:test");
    try {
      expect(second.hasParticipants()).toBe(true);
    } finally {
      first.removeParticipant(runner);
    }
    expect(second.hasParticipants()).toBe(false);
  });
});

describe("a plugin a reload switched off", () => {
  it("is neither asked nor told while its owner is suspended", async () => {
    const { getActiveHookRegistry } = await import(
      "../../../hooks/hook-registry"
    );
    const registry = getActiveHookRegistry();
    const before = registry.getSuspendedOwners();
    const off = fake(new Map([["en|/blog/hello", page]]));
    const on = fake();
    addParticipant(off.runner, "plugin:off");
    added.push(off.runner);
    join(on.runner);
    registry.setSuspendedOwners(["plugin:off"]);
    const update = { holder: post, holds: [en] };

    try {
      expect(await firstHolder(update, [update], tx, key)).toBeNull();
      await recordEverywhere([update], tx, key);
    } finally {
      registry.setSuspendedOwners(before);
    }

    expect(off.asked).toEqual([]);
    expect(off.recorded).toEqual([]);
    expect(on.recorded).toEqual([[update]]);
  });

  it("is left out of the plugins a start or a reload records as taking part", async () => {
    const { getActiveHookRegistry } = await import(
      "../../../hooks/hook-registry"
    );
    const registry = getActiveHookRegistry();
    const before = registry.getSuspendedOwners();
    const off = fake();
    addParticipant(off.runner, "plugin:off");
    added.push(off.runner);
    // Two participants of one plugin name it once.
    const on = fake();
    const onAgain = fake();
    addParticipant(on.runner, "plugin:on");
    added.push(on.runner);
    addParticipant(onAgain.runner, "plugin:on");
    added.push(onAgain.runner);

    expect(participatingOwners()).toEqual(["plugin:off", "plugin:on"]);
    registry.setSuspendedOwners(["plugin:off"]);
    try {
      expect(participatingOwners()).toEqual(["plugin:on"]);
    } finally {
      registry.setSuspendedOwners(before);
    }
  });
});
