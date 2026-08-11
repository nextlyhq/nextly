import { describe, expect, it } from "vitest";

import {
  classifyPreflight,
  getExpectedDistTag,
  isBootstrapPlaceholderOnly,
  PLACEHOLDER_VERSION,
} from "./lib.mjs";

const VERSION = "0.0.2-alpha.52";

/** A manifest entry whose publish metadata is complete, so only state matters. */
function entry(name, version = VERSION) {
  return {
    name,
    version,
    dir: `/packages/${name}`,
    manifestPath: `/packages/${name}/package.json`,
    pkg: {
      name,
      version,
      license: "MIT",
      repository: { directory: `packages/${name}` },
      publishConfig: { access: "public" },
      engines: { node: ">=20.0.0" },
    },
  };
}

/** Registry state for a package that has published real versions. */
function released(versions = [PLACEHOLDER_VERSION, "0.0.2-alpha.51"]) {
  return { versions, distTags: { alpha: versions[versions.length - 1] } };
}

/** Registry state for a name that has only ever been bootstrapped. */
function placeholderOnly() {
  return {
    versions: [PLACEHOLDER_VERSION],
    distTags: { latest: PLACEHOLDER_VERSION },
  };
}

function registryOf(pairs) {
  return new Map(Object.entries(pairs));
}

describe("isBootstrapPlaceholderOnly", () => {
  it("is true for a name carrying only the placeholder", () => {
    expect(isBootstrapPlaceholderOnly(placeholderOnly())).toBe(true);
  });

  it("is false once a real version exists beside it", () => {
    expect(isBootstrapPlaceholderOnly(released())).toBe(false);
  });

  it("is false for a name npm has never heard of", () => {
    // A different situation with a different fix: that one needs the name
    // claimed, this one needs its publisher configured.
    expect(isBootstrapPlaceholderOnly(null)).toBe(false);
  });

  it("is false for a package whose only version is a real one", () => {
    expect(isBootstrapPlaceholderOnly(released(["1.0.0"]))).toBe(false);
  });
});

describe("classifyPreflight", () => {
  it("refuses a package that carries only its bootstrap placeholder", () => {
    const manifest = [entry("nextly"), entry("@nextlyhq/new-package")];
    const registry = registryOf({
      nextly: released(),
      "@nextlyhq/new-package": placeholderOnly(),
    });

    const result = classifyPreflight(manifest, registry, VERSION);

    expect(result.unprovenPublisher).toEqual(["@nextlyhq/new-package"]);
    // And it is NOT confused with the unclaimed case, which needs a different fix.
    expect(result.bootstrapNeeded).toEqual([]);
  });

  it("reproduces the partial-train scenario it exists to prevent", () => {
    // Seventeen packages ready, one claimed but never published. Publishing
    // would put the seventeen live and strand the last, with no tag and no
    // release describing any of them.
    const names = Array.from({ length: 17 }, (_, i) => `@nextlyhq/pkg-${i}`);
    const manifest = [
      ...names.map(name => entry(name)),
      entry("@nextlyhq/late"),
    ];
    const registry = registryOf({
      ...Object.fromEntries(names.map(name => [name, released()])),
      "@nextlyhq/late": placeholderOnly(),
    });

    const result = classifyPreflight(manifest, registry, VERSION);

    expect(result.unprovenPublisher).toEqual(["@nextlyhq/late"]);
    expect(result.toPublish).toHaveLength(18);
  });

  it("allows a placeholder-only package once it is acknowledged", () => {
    const manifest = [entry("@nextlyhq/new-package")];
    const registry = registryOf({ "@nextlyhq/new-package": placeholderOnly() });

    const result = classifyPreflight(manifest, registry, VERSION, [
      "@nextlyhq/new-package",
    ]);

    expect(result.unprovenPublisher).toEqual([]);
    // The first publish is exactly what the acknowledgement is for.
    expect(result.toPublish).toEqual(["@nextlyhq/new-package"]);
  });

  it("reports an acknowledgement that has outlived its purpose", () => {
    const manifest = [entry("@nextlyhq/settled")];
    const registry = registryOf({ "@nextlyhq/settled": released() });

    const result = classifyPreflight(manifest, registry, VERSION, [
      "@nextlyhq/settled",
    ]);

    expect(result.staleAcknowledgements).toEqual(["@nextlyhq/settled"]);
    // Reporting it must not block: the release itself is fine.
    expect(result.unprovenPublisher).toEqual([]);
  });

  it("does not report a stale acknowledgement for a package still awaiting one", () => {
    const manifest = [entry("@nextlyhq/new-package")];
    const registry = registryOf({ "@nextlyhq/new-package": placeholderOnly() });

    const result = classifyPreflight(manifest, registry, VERSION, [
      "@nextlyhq/new-package",
    ]);

    expect(result.staleAcknowledgements).toEqual([]);
  });

  it("still refuses a name npm has never seen", () => {
    const manifest = [entry("@nextlyhq/unclaimed")];
    const registry = registryOf({ "@nextlyhq/unclaimed": null });

    const result = classifyPreflight(manifest, registry, VERSION);

    expect(result.bootstrapNeeded).toEqual(["@nextlyhq/unclaimed"]);
    // An acknowledgement cannot substitute for the name existing.
    const acknowledged = classifyPreflight(manifest, registry, VERSION, [
      "@nextlyhq/unclaimed",
    ]);
    expect(acknowledged.bootstrapNeeded).toEqual(["@nextlyhq/unclaimed"]);
  });

  it("treats a package missing from the registry map as unclaimed", () => {
    // `fetchAllRegistryStates` always populates every key, but a caller that
    // built the map another way must not have the package silently skipped.
    const result = classifyPreflight(
      [entry("@nextlyhq/absent")],
      new Map(),
      VERSION
    );
    expect(result.bootstrapNeeded).toEqual(["@nextlyhq/absent"]);
  });

  it("separates what is already live from what still needs publishing", () => {
    const manifest = [entry("a"), entry("b")];
    const registry = registryOf({
      a: released([PLACEHOLDER_VERSION, VERSION]),
      b: released([PLACEHOLDER_VERSION, "0.0.2-alpha.51"]),
    });

    const result = classifyPreflight(manifest, registry, VERSION);

    expect(result.alreadyPublished).toEqual(["a"]);
    expect(result.toPublish).toEqual(["b"]);
  });

  it("catches a package that drifted off the lockstep version", () => {
    const manifest = [entry("a"), entry("b", "0.0.2-alpha.51")];
    const registry = registryOf({ a: released(), b: released() });

    const result = classifyPreflight(manifest, registry, VERSION);

    expect(result.versionMismatch).toEqual([
      { name: "b", version: "0.0.2-alpha.51" },
    ]);
  });

  it("names every missing publish field rather than the first", () => {
    const incomplete = entry("a");
    delete incomplete.pkg.license;
    incomplete.pkg.publishConfig = { access: "restricted" };

    const result = classifyPreflight(
      [incomplete],
      registryOf({ a: released() }),
      VERSION
    );

    expect(result.metadataErrors).toHaveLength(1);
    expect(result.metadataErrors[0].missing).toContain("license");
    expect(
      result.metadataErrors[0].missing.some(field =>
        field.startsWith("publishConfig.access")
      )
    ).toBe(true);
  });
});

describe("which dist-tag a package publishes to", () => {
  const PRE = { mode: "pre", tag: "alpha" };

  it("uses the active prerelease tag for a package with a stable version", () => {
    expect(
      getExpectedDistTag({ versions: ["0.0.0", VERSION], distTags: {} }, PRE)
    ).toBe("alpha");
  });

  it("moves `latest` when nothing but prereleases of the active tag exist", () => {
    // Changesets' own `only-pre` rule: a package with no regular release yet
    // publishes to `latest`. Asserted rather than assumed, because it is the
    // reason the case below matters.
    expect(getExpectedDistTag({ versions: [VERSION], distTags: {} }, PRE)).toBe(
      "latest"
    );
  });

  it("treats the bootstrap placeholder as the stable version that holds the tag", () => {
    // The placeholder does two jobs and only one is obvious. `0.0.0` carries no
    // prerelease identifier, so its presence is what makes a package NOT
    // only-pre — and therefore what keeps `latest` off the alpha channel. The
    // two assertions differ by the placeholder alone.
    const withPlaceholder = { versions: [PLACEHOLDER_VERSION, VERSION] };
    const withoutPlaceholder = { versions: [VERSION] };

    expect(getExpectedDistTag(withPlaceholder, PRE)).toBe("alpha");
    expect(getExpectedDistTag(withoutPlaceholder, PRE)).toBe("latest");
  });

  it("uses `latest` outside prerelease mode whatever the registry holds", () => {
    expect(
      getExpectedDistTag({ versions: [VERSION], distTags: {} }, null)
    ).toBe("latest");
  });

  it("does not classify a package whose prereleases are of ANOTHER tag", () => {
    // `only-pre` is narrower than "has no stable version": every published
    // version must be a prerelease of the ACTIVE tag. A beta-only package under
    // an alpha train publishes to alpha, and expecting `latest` here would
    // reject a correct publish on every retry.
    expect(
      getExpectedDistTag({ versions: ["0.0.2-beta.1"], distTags: {} }, PRE)
    ).toBe("alpha");
  });
});
