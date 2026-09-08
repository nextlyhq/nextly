/**
 * A real, active user to attribute a release member to.
 *
 * The read path projects a due member only when its author still exists and is
 * still active, matching the write path — which runs every action AS that
 * person, so that scheduling cannot become a privilege escalation with a delay
 * on it. A fixture that leaves `createdBy` unset is therefore describing a
 * member no write could ever perform, and it is now correctly invisible.
 *
 * Seeding one real author is the smallest change that keeps these suites
 * testing what they claim to test, rather than a projection that only worked
 * because nobody was checked.
 *
 * @module domains/releases/__tests__/helpers/live-author
 */
import type { TestNextly } from "../../../../plugins/test-nextly";

let seq = 0;

/** Create an active user and return its id. */
export async function seedLiveAuthor(t: TestNextly): Promise<string> {
  seq += 1;
  // Through the public Direct API rather than a service key, so this helper
  // keeps working if the container's wiring is renamed.
  const created = (await t.nextly.users.create({
    email: `release-author-${seq}@example.com`,
    password: "Str0ng!Passw0rd#2026",
    data: { name: `Release Author ${seq}` },
  })) as unknown as { item?: { id?: string }; id?: string };
  const id = created.item?.id ?? created.id;
  if (typeof id !== "string") {
    throw new Error(`seedLiveAuthor: no id in ${JSON.stringify(created)}`);
  }
  // MEASURED: a user created through the Direct API lands with `is_active = 0`.
  // So "created" is not "able to act", and a fixture that only created one would
  // be seeding exactly the account the read path is supposed to refuse — every
  // assertion would then pass for the wrong reason on a broken filter, and fail
  // for the wrong reason on a correct one.
  await setActive(t, id, true);
  return id;
}

/**
 * Set a user's active flag directly.
 *
 * Written to the column rather than through a service, so the fixture states the
 * condition under test — "this account can/cannot act" — without depending on
 * which of several service paths happens to set it.
 *
 * Through the adapter's typed `update` rather than a SQL string. A hand-written
 * `UPDATE "users" …` runs on SQLite and Postgres and FAILS on MySQL, which
 * without `ANSI_QUOTES` reads a double-quoted token as a string literal rather
 * than an identifier — so every test in the MySQL leg of
 * `getConfiguredTestDialects` would have died in the fixture, before reaching
 * the behaviour it claims to check.
 */
export async function setActive(
  t: TestNextly,
  id: string,
  active: boolean
): Promise<void> {
  const adapter = t.adapter as unknown as {
    update: (
      table: string,
      values: Record<string, unknown>,
      where: unknown
    ) => Promise<unknown>;
  };
  await adapter.update(
    "users",
    { isActive: active },
    { and: [{ column: "id", op: "=", value: id }] }
  );
}

/** Withdraw a user's access, the way deactivating an account does. */
export async function deactivate(t: TestNextly, id: string): Promise<void> {
  await setActive(t, id, false);
}
