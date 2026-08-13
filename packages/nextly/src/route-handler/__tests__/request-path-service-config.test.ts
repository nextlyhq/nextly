/**
 * A cold boot triggered by a request must register the same shape an
 * instrumentation boot does.
 *
 * The two paths used to answer that question separately: one called
 * `buildServiceConfig`, the other re-listed the config blocks by hand. Every
 * block added to one and forgotten in the other produced the same silent
 * failure — the value resolves, defaults, and then governs nothing, with no
 * error anywhere to say so. It has happened to `admin.devAutoLogin`, to
 * app-defined Singles, to `localization`, and most recently to
 * `emailRetention`, where the delivery log simply never got swept.
 *
 * So the property under test is not "this one field is forwarded". It is that
 * the request path DERIVES its answer, and that the only differences from the
 * canonical builder are ones somebody declared on purpose.
 */

import { describe, expect, it } from "vitest";

import type { SanitizedNextlyConfig } from "../../shared/types/config";
import { resolveEmailRetentionConfig } from "../../domains/email/retention-config";
import { buildServiceConfig } from "../../init/build-service-config";
import { requestPathServiceConfig } from "../auth-handler";

function configWith(
  partial: Partial<SanitizedNextlyConfig>
): SanitizedNextlyConfig {
  return partial as SanitizedNextlyConfig;
}

/**
 * The keys the request path is ALLOWED to add on top of the builder's answer.
 *
 * Not a convenience list: it is the whole safety property. Anything the request
 * path forwards that the builder does not is a difference between how an app
 * behaves under `instrumentation.ts` and under a cold request, and it belongs
 * here only once someone has decided it should exist.
 */
const DECLARED_REQUEST_PATH_ONLY_KEYS = ["schemasDir", "migrationsDir"];

describe("the service config a request-path cold boot registers", () => {
  it("carries the delivery-log retention policy", () => {
    // The regression this file was added for. Absent, no sweep is registered,
    // and an unregistered pass does not run, log, or appear anywhere — so the
    // table grows while the configured window reads as enforced.
    const emailRetention = resolveEmailRetentionConfig({ maxAgeMs: 1000 });

    expect(
      requestPathServiceConfig(configWith({ emailRetention }))
    ).toHaveProperty("emailRetention", emailRetention);
  });

  it("differs from the canonical builder only where declared", () => {
    // The guard that outlives any single field. A config carrying every block
    // the builder knows about, compared key-for-key against what the builder
    // itself produces: re-inlining a partial list fails here even if the field
    // this file was written for is still in it.
    const config = configWith({
      collections: [],
      singles: [],
      fieldGroups: [],
      plugins: [],
      permissions: [],
      storage: [],
      users: {},
      email: {},
      apiKeys: {},
      security: {},
      admin: {},
      auth: {},
      localization: {
        locales: [
          { code: "en", label: "English", rtl: false, fallbackLocale: [] },
        ],
        defaultLocale: "en",
        fallback: true,
      },
      // `null` is the meaningful "retention off" value here and must survive
      // the hop as itself rather than collapsing into absent.
      webhookRetention: null,
      webhookAuditEnabled: true,
      auditRetention: {},
      emailRetention: resolveEmailRetentionConfig(),
      db: {
        schemasDir: "./custom/schemas",
        migrationsDir: "./custom/migrations",
      },
    } as unknown as Partial<SanitizedNextlyConfig>);

    const canonical = buildServiceConfig({ config });
    const requestPath = requestPathServiceConfig(config);

    const extra = Object.keys(requestPath).filter(key => !(key in canonical));
    expect(extra.sort()).toEqual([...DECLARED_REQUEST_PATH_ONLY_KEYS].sort());

    // Every key the builder produced must also be present, and equal. A
    // missing one is the exact failure this file exists for; an unequal one
    // means the request path re-derived a value instead of asking.
    for (const key of Object.keys(canonical)) {
      expect(requestPath).toHaveProperty(key);
      expect(requestPath[key as keyof typeof requestPath]).toEqual(
        canonical[key as keyof typeof canonical]
      );
    }
  });

  it("forwards the database directories the builder deliberately does not", () => {
    // The one real divergence, and it is a disagreement rather than an
    // omission: with no `schemasDir`, `register-collections.ts` falls back to
    // `<basePath>/src/db/schemas/dynamic`, while `config.db.schemasDir`
    // defaults to `./src/db/schemas/collections`. Pinned so that forwarding it
    // stays a decision somebody made rather than an accident.
    const result = requestPathServiceConfig(
      configWith({
        db: { schemasDir: "./a", migrationsDir: "./b" },
      } as unknown as Partial<SanitizedNextlyConfig>)
    );

    expect(result.schemasDir).toBe("./a");
    expect(result.migrationsDir).toBe("./b");
  });

  it("still yields an image processor when no config was stored", () => {
    // `setHandlerConfig()` may never have run. Registration still needs a
    // processor, and reaching for media storage here would build a
    // plugin-less singleton that permanently falls back to local.
    const result = requestPathServiceConfig(null);

    expect(result.imageProcessor).toBeDefined();
    expect(result.collections).toBeUndefined();
  });
});
