/**
 * The plugin sends no webhooks of its own. Submissions reach other systems
 * through Nextly's `form.submission.created` webhook, so the plugin's senders,
 * and the `notifications.webhooks` option only they read, are gone.
 *
 * The removed types are held by the type check and the built declarations;
 * these tests hold what a running app sees: the entry's exports, and the
 * warning a form config written before the removal still gets.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyFormDefaults } from "../config/defaults";
import * as entry from "../index";
import type { FormConfig } from "../types";

describe("the plugin's own webhook senders", () => {
  it("are not exported", () => {
    for (const name of [
      "triggerWebhooks",
      "fireWebhooks",
      "isValidWebhookUrl",
      "getSupportedWebhookEvents",
    ]) {
      expect(Object.keys(entry), name).not.toContain(name);
    }
  });
});

describe("a form config that still sets notifications.webhooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A JavaScript config, or one written before the option was removed, still
  // carries the key: no type error reaches it, so the warning is what tells
  // its author the webhooks will not be sent.
  const legacy = {
    slug: "contact",
    fields: [],
    notifications: {
      webhooks: [
        { url: "https://example.com/hook", events: ["submission.created"] },
      ],
    },
  } as unknown as FormConfig;

  it("warns once, naming the core event to subscribe to instead", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    applyFormDefaults(legacy);

    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0];
    expect(message).toContain('"contact"');
    expect(message).toContain("notifications.webhooks");
    expect(message).toContain("form.submission.created");
  });

  it("does not carry the option into the resolved config", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const resolved = applyFormDefaults(legacy);

    expect(resolved.notifications).not.toHaveProperty("webhooks");
  });

  it("says nothing for a config without it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    applyFormDefaults({
      slug: "contact",
      fields: [],
      notifications: { enabled: true },
    } as FormConfig);

    expect(warn).not.toHaveBeenCalled();
  });
});
