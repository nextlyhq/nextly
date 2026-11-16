/**
 * `createTestNextly` on an adapter the caller made, in a process with no
 * NEXTLY_SECRET: the instance is given one, so `runWidgetLoad` can sign a
 * person in, and the process has none again once the instance is destroyed.
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import { createAdapter } from "../../database/factory";
import { defineWidget } from "../../domains/widgets/declaration/define-widget";
import { _resetEnvCache } from "../../shared/lib/env";
import { createTestNextly, type TestNextly } from "../test-nextly";
import { runWidgetLoad } from "../test-widget-load";

const answered = defineWidget({
  id: "site/answered",
  title: "Answered",
  description: "A number the test reads back",
  size: { default: { w: 6, h: 3 } },
  load: async () => ({ total: 7 }),
  view: "figure",
});

let secretBefore: string | undefined;
let t: TestNextly | undefined;

// The setup file sets a secret for every suite; this one runs without it.
beforeEach(() => {
  secretBefore = process.env.NEXTLY_SECRET;
  delete process.env.NEXTLY_SECRET;
  _resetEnvCache();
});

afterEach(async () => {
  await t?.destroy();
  t = undefined;
  if (secretBefore === undefined) delete process.env.NEXTLY_SECRET;
  else process.env.NEXTLY_SECRET = secretBefore;
  _resetEnvCache();
});

it("gives an instance on the caller's own adapter a secret, and takes it back", async () => {
  // `memory: true` is honoured by the SQLite adapter but not declared by the
  // factory's config type, as in createTestNextly's own SQLite boot.
  const adapter = await createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
  t = await createTestNextly({ adapter, widgets: [answered] });
  const admin = await t.nextly.users.create({
    email: "admin@example.com",
    password: "Password123!",
    data: { name: "Admin", isActive: true },
  });
  expect(
    await runWidgetLoad(t, answered, { as: { id: admin.item.id } })
  ).toEqual({ state: "ready", data: { total: 7 } });
  await t.destroy();
  t = undefined;
  expect(process.env.NEXTLY_SECRET).toBeUndefined();
});
