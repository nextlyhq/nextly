/**
 * A form closes by its closing time and by its limit, on every dialect: a
 * submission past either is refused with the form's closed message, spam does
 * not count, the count follows spam marking and deletion, and submissions
 * racing for the last places cannot take more than there are.
 */
import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";

const CLOSED = "Sign-ups are closed. Follow us for the next one.";

/** The live plugin context, captured by a plugin booted beside the forms. */
function contextProbe(name: string) {
  let captured: PluginContext | undefined;
  const plugin = definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: context => {
      captured = context;
    },
  });
  return {
    plugin,
    get: (): PluginContext => {
      if (!captured) throw new Error("probe plugin did not initialize");
      return captured;
    },
  };
}

describe.each(getConfiguredTestDialects())("closing a form (%s)", dialect => {
  let current: TestNextly | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await current?.destroy();
    current = undefined;
  });

  async function boot(settings: Record<string, unknown>) {
    const fb = formBuilder({
      spamProtection: { honeypot: true, recaptcha: { enabled: false } },
    });
    const probe = contextProbe("@test/fb-closing");
    current = await createTestNextly({
      dialect,
      plugins: [fb.plugin, probe.plugin],
      seedPublic: true,
    });
    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Meetup",
        slug: "meetup",
        status: "published",
        closedMessage: CLOSED,
        fields: [{ type: "text", name: "name", label: "Name" }],
        settings: { honeypotEnabled: true, ...settings },
      },
    });
    const submit = (data: Record<string, unknown> = { name: "Ada" }) =>
      submitForm(
        { formSlug: "meetup", data },
        { pluginContext: probe.get(), pluginConfig: fb.config }
      );
    return { nextly: current.nextly, submit };
  }

  /** The form's non-spam submissions, as stored. */
  async function taken(nextly: TestNextly["nextly"]) {
    const { items } = await nextly.find({
      collection: "form-submissions",
      where: { status: { not_equals: "spam" } },
      limit: 100,
    });
    return items as { id: string }[];
  }

  it("refuses a submission once its closing time has passed", async () => {
    const closesAt = new Date(Date.now() + 60_000);
    const { submit } = await boot({ closesAt: closesAt.toISOString() });
    expect((await submit()).success).toBe(true);

    // The clock moved past the closing time; only Date is faked, so the
    // database's own timers run as ever.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(closesAt.getTime() + 1_000);

    const late = await submit();
    expect(late).toMatchObject({
      success: false,
      outcome: "closed",
      error: CLOSED,
    });

    // The public read explains it the same way, rather than serving fields.
    const res = await createDynamicHandlers().GET(
      new Request("http://localhost/api/forms/meetup"),
      { params: Promise.resolve({ params: ["forms", "meetup"] }) }
    );
    expect(await res.json()).toMatchObject({
      status: "closed",
      closedMessage: CLOSED,
    });
  });

  it("refuses the Direct API past its closing time, and its limit too", async () => {
    // `nextly.forms.submit()` stores a submission without `submitForm`, so
    // the closing is held where every submission is stored.
    const closesAt = new Date(Date.now() + 60_000);
    const { nextly, submit } = await boot({
      closesAt: closesAt.toISOString(),
      submissionLimit: 1,
    });
    const direct = (
      nextly as unknown as {
        forms: {
          submit: (args: { form: string; data: object }) => Promise<unknown>;
        };
      }
    ).forms;

    expect((await submit()).success).toBe(true);
    // Full: the Direct API is refused, with the closed message.
    await expect(
      direct.submit({ form: "meetup", data: { name: "Grace" } })
    ).resolves.toEqual({ success: false, error: CLOSED });

    // Past the closing time, too, once a place is freed.
    const [first] = await taken(nextly);
    await nextly.delete({ collection: "form-submissions", id: first!.id });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(closesAt.getTime() + 1_000);
    await expect(
      direct.submit({ form: "meetup", data: { name: "Grace" } })
    ).resolves.toEqual({ success: false, error: CLOSED });
    expect(await taken(nextly)).toHaveLength(0);
  });

  it("takes submissions again once its closing time is cleared", async () => {
    const { nextly, submit } = await boot({
      closesAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect((await submit()).outcome).toBe("closed");

    // Saved as the editor saves it: the whole settings group, without the
    // closing time the switch cleared.
    const { items } = await nextly.find({ collection: "forms" });
    await nextly.update({
      collection: "forms",
      id: (items[0] as { id: string }).id,
      data: { settings: { honeypotEnabled: true }, _overwrite: true },
    });
    expect((await submit()).success).toBe(true);
  });

  it("refuses a submission once its limit is met, and spam does not count", async () => {
    const { nextly, submit } = await boot({ submissionLimit: 2 });
    expect((await submit()).success).toBe(true);
    // Caught by the trap field: stored as spam, and no place taken.
    expect((await submit({ name: "Bot", _hp: "filled" })).success).toBe(true);
    expect((await submit()).success).toBe(true);

    expect(await submit()).toMatchObject({
      success: false,
      outcome: "closed",
      error: CLOSED,
    });
    expect(await taken(nextly)).toHaveLength(2);
  });

  it("gives a place back when a submission is marked spam or deleted", async () => {
    const { nextly, submit } = await boot({ submissionLimit: 2 });
    await submit();
    await submit();
    expect((await submit()).outcome).toBe("closed");

    const [first, second] = await taken(nextly);
    await nextly.update({
      collection: "form-submissions",
      id: first!.id,
      data: { status: "spam", _overwrite: true },
    });
    expect((await submit()).success).toBe(true);
    expect((await submit()).outcome).toBe("closed");

    await nextly.delete({ collection: "form-submissions", id: second!.id });
    expect((await submit()).success).toBe(true);
    expect((await submit()).outcome).toBe("closed");
    expect(await taken(nextly)).toHaveLength(2);
  });

  it("accepts exactly as many as the limit when submissions race for the last places", async () => {
    const { nextly, submit } = await boot({ submissionLimit: 2 });
    await submit();

    // One place left, five at once.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, n) => submit({ name: `Racer ${n}` }))
    );

    expect(results.filter(result => result.success)).toHaveLength(1);
    for (const refused of results.filter(result => !result.success)) {
      expect(refused).toMatchObject({ outcome: "closed", error: CLOSED });
    }
    expect(await taken(nextly)).toHaveLength(2);
  });
});
