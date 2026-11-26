/**
 * The SQLite hold of an entity in this process: a save and the entry writes beside it never hold
 * the entity at once, however close together they are asked for, a save woken among others
 * included.
 */
import { describe, expect, it } from "vitest";

import {
  holdEntityInProcess,
  shareEntityInProcess,
  type EntityRef,
} from "../entity-hold";

const entity: EntityRef = { kind: "collection", slug: "posts" };

/** What `asked` ends with: the release it was granted, or its refusal. */
const settled = <T>(asked: Promise<T>): Promise<T | { refused: unknown }> =>
  asked.catch((refused: unknown) => ({ refused }));

describe("an entity held in this process", () => {
  it("grants no save while a write asked for just before it shares the entity", async () => {
    const owner = {};
    // Neither awaited before the other is asked: one flow's answer must not wait on a turn the
    // other can take first.
    const sharing = shareEntityInProcess(owner, entity);
    const saving = settled(holdEntityInProcess(owner, entity, { waitMs: 50 }));
    const release = await sharing;
    expect(await saving).toMatchObject({
      refused: { code: "COLLECTION_BEING_CHANGED" },
    });
    release();
  });

  it("grants one save at a time where two are asked for together", async () => {
    const owner = {};
    const first = holdEntityInProcess(owner, entity, { waitMs: 50 });
    const second = settled(holdEntityInProcess(owner, entity, { waitMs: 50 }));
    const release = await first;
    expect(await second).toMatchObject({
      refused: { code: "COLLECTION_BEING_CHANGED" },
    });
    release();
  });

  it("grants one of the saves woken together when the entity is let go", async () => {
    const owner = {};
    const release = await holdEntityInProcess(owner, entity);
    const granted: string[] = [];
    const waiting = ["second", "third"].map(name =>
      settled(
        holdEntityInProcess(owner, entity, { waitMs: 100 }).then(letGo => {
          granted.push(name);
          return letGo;
        })
      )
    );
    release();
    await Promise.all(waiting);
    expect(granted).toHaveLength(1);
  });

  it("lets a write share the entity once the save has let it go", async () => {
    const owner = {};
    const release = await holdEntityInProcess(owner, entity);
    const sharing = settled(shareEntityInProcess(owner, entity, () => 200));
    release();
    const shared = await sharing;
    expect(typeof shared).toBe("function");
  });
});
