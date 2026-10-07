/**
 * `ctx.config` is a copy, frozen all the way down, of the settings a plugin
 * may read.
 *
 * It used to be a frozen object whose VALUES were the service configuration's
 * own: `ctx.config.security.uploads` was the object the upload policy reads,
 * `ctx.config.collections[i]` the collection core enforces access from, and
 * `ctx.config.plugins[i]` another plugin's definition. A write through any of
 * them changed what core does next. Observed through `createPluginContext`,
 * the seam a plugin receives it from, and through the container's `config`
 * service, which is what core reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NextlyServiceConfig } from "../di/register";
import { container } from "../di/container";
import { resolveUploadPolicy } from "../services/upload-validation/upload-policy";

import { createPluginContext } from "./plugin-context";

afterEach(() => {
  container.clear();
});

/** The service configuration an app with one listed raw-SQL plugin boots with. */
function serviceConfig() {
  const victimInit = () => undefined;
  const victim = {
    name: "@acme/reports",
    version: "1.0.0",
    nextly: "*",
    capabilities: { db: { rawSql: true } },
    init: victimInit,
    contributes: { declarations: { "@acme/pb": { blocks: ["chart"] } } },
  };
  const access = { read: () => true };
  const config = {
    security: { uploads: { svgCsp: true, allowedMimeTypes: ["image/png"] } },
    collections: [{ slug: "posts", fields: [], access }],
    plugins: [victim],
    email: {
      from: "Acme <noreply@example.com>",
      appName: "Acme",
      providerConfig: { provider: "resend", apiKey: "re_secret" },
    },
  } as unknown as NextlyServiceConfig;
  return { config, victim, victimInit, access };
}

/** `ctx.config` for a plugin, built as the boot builds it. */
function contextConfig(config: NextlyServiceConfig) {
  const getService = ((name: string) =>
    name === "config"
      ? config
      : name === "logger"
        ? { debug() {}, info() {}, warn() {}, error() {} }
        : {}) as Parameters<typeof createPluginContext>[0];
  const registry = {
    register: vi.fn(),
    unregister: vi.fn(),
    registerBeforeOperation: vi.fn(),
    unregisterBeforeOperation: vi.fn(),
  };
  return createPluginContext(getService, registry, {
    name: "@evil/p",
    version: "1.0.0",
    nextly: "*",
  }).config;
}

/** A write `ctx.config` must refuse: it throws, and the app's value stays. */
function refuses(write: () => void): void {
  expect(write).toThrow(TypeError);
}

describe("ctx.config", () => {
  it("refuses a write to a nested setting and leaves the upload policy alone", () => {
    const { config } = serviceConfig();
    container.registerSingleton("config", () => config);
    const view = contextConfig(config) as unknown as {
      security: { uploads: { svgCsp: boolean; allowedMimeTypes: string[] } };
    };

    refuses(() => {
      view.security.uploads.svgCsp = false;
    });
    refuses(() => {
      view.security.uploads.allowedMimeTypes.push("text/html");
    });

    const served = container.get<NextlyServiceConfig>("config");
    expect(served.security?.uploads).toEqual({
      svgCsp: true,
      allowedMimeTypes: ["image/png"],
    });
    expect(resolveUploadPolicy().svgCsp).toBe(true);
  });

  it("refuses a write to a collection's access", () => {
    const { config, access } = serviceConfig();
    const view = contextConfig(config) as unknown as {
      collections: Array<{ access: { read: () => boolean } }>;
    };

    refuses(() => {
      view.collections[0].access.read = () => false;
    });
    refuses(() => {
      view.collections[0].access = { read: () => false };
    });
    expect(config.collections?.[0]).toMatchObject({ access });
    expect(access.read()).toBe(true);
  });

  it("lists plugin summaries, not definitions", () => {
    const { config, victim, victimInit } = serviceConfig();
    const view = contextConfig(config);
    const listed = view.plugins?.[0] as unknown as Record<string, unknown>;

    expect(view.plugins).toEqual([
      {
        name: "@acme/reports",
        version: "1.0.0",
        enabled: true,
        capabilities: { db: { rawSql: true } },
        contributes: { declarations: { "@acme/pb": { blocks: ["chart"] } } },
      },
    ]);
    expect(listed).not.toHaveProperty("init");
    refuses(() => {
      listed.init = () => "evil";
    });
    refuses(() => {
      (listed.capabilities as { db: { rawSql: boolean } }).db.rawSql = false;
    });
    expect(victim.init).toBe(victimInit);
    expect(victim.capabilities).toEqual({ db: { rawSql: true } });
  });

  it("carries the email settings without the provider's credentials", () => {
    const { config } = serviceConfig();
    const view = contextConfig(config);

    expect(view.email).toEqual({
      from: "Acme <noreply@example.com>",
      appName: "Acme",
    });
    expect(view.email).not.toHaveProperty("providerConfig");
  });
});
