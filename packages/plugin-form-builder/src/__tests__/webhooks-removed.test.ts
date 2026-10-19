/**
 * The plugin sends no webhooks of its own. Submissions reach other systems
 * through Nextly's `form.submission.created` webhook, so the plugin's senders,
 * and the `notifications.webhooks` option only they read, are gone.
 *
 * The removed types are held by the type check and the built declarations;
 * these tests hold what a running app sees: the entry's exports, and the
 * warning a form config written before the removal still gets, whichever
 * public way it comes in by.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyFormDefaults } from "../config/defaults";
import { validateFormConfig } from "../config/validate-form";
import * as entry from "../index";
import type { FormConfig } from "../types";

describe("the plugin's own webhook senders", () => {
  it("are not exported, while the rest of the entry still is", () => {
    // The positive control: an emptied entry would also export no sender.
    for (const kept of [
      "formBuilder",
      "submitForm",
      "createFormConfig",
      "validateFormConfig",
    ]) {
      expect(Object.keys(entry), kept).toContain(kept);
    }
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
  // its author the webhooks will not be sent. Each test names its own form,
  // since a form is told once however many entry points it passes through.
  const legacy = (slug: string) =>
    ({
      slug,
      fields: [],
      notifications: {
        enabled: false,
        recipients: [],
        webhooks: [
          { url: "https://example.com/hook", events: ["submission.created"] },
        ],
      },
    }) as unknown as FormConfig;

  it("warns from applyFormDefaults, naming the core event to subscribe to instead", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    applyFormDefaults(legacy("contact"));

    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0];
    expect(message).toContain('"contact"');
    expect(message).toContain("notifications.webhooks");
    expect(message).toContain("form.submission.created");
  });

  it("warns from validateFormConfig too, and still validates the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = validateFormConfig(legacy("newsletter"));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"newsletter"');
    expect(result.errors.map(error => error.path)).not.toContain(
      "notifications.webhooks"
    );
  });

  it("tells a form once when it passes through both", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = legacy("signup");
    validateFormConfig(config);
    applyFormDefaults(config);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not carry the option into the resolved config", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const resolved = applyFormDefaults(legacy("feedback"));

    expect(resolved.notifications).not.toHaveProperty("webhooks");
  });

  it("says nothing for a config without it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    applyFormDefaults({
      slug: "quiet",
      fields: [],
      notifications: { enabled: true, recipients: [] },
    } as FormConfig);

    expect(warn).not.toHaveBeenCalled();
  });
});
