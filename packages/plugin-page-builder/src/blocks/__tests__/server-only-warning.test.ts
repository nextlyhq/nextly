/**
 * A block registered in code, rather than declared, reaches the server only,
 * and development says so once, naming it.
 *
 * Declared blocks are registered by the page builder itself and never pass
 * through `blockRegistry(ctx).register`, so they are the control: declaring
 * the same kind of block must produce no warning at all. The count is exact,
 * because "warns once" is the property, and a warning per boot or per call
 * would bury the one that matters.
 */
import {
  clearBlocks,
  getBlock,
  type AnyBlockDefinition,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Service = typeof import("../registration-service");

let service: Service;

beforeEach(async () => {
  clearBlocks();
  // A fresh module for each test: the warning is remembered per process.
  vi.resetModules();
  service = await import("../registration-service");
});

afterEach(() => {
  clearBlocks();
  vi.unstubAllEnvs();
});

function block(name: string): AnyBlockDefinition {
  return {
    name,
    version: 1,
    description: `The ${name} block.`,
    example: { props: {} },
    props: {},
    render: () => null,
  } as unknown as AnyBlockDefinition;
}

/** A context as boot hands one to a contributing plugin. */
function contextFor(plugins: unknown[] = []) {
  const warn = vi.fn();
  const backend = service.createBlockRegistrationService();
  const ctx = {
    self: { name: "@acme/blocks" },
    logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: { plugins },
    services: {
      plugins: {
        [service.PAGE_BUILDER_PLUGIN]: { [service.BLOCK_SERVICE]: backend },
      },
    },
  } as unknown as Parameters<Service["blockRegistry"]>[0];
  return { ctx, warn };
}

describe("a block registered in code but not declared", () => {
  it("warns once in development, naming the block", () => {
    vi.stubEnv("NODE_ENV", "development");
    const { ctx, warn } = contextFor();

    service.blockRegistry(ctx).register(block("acme/ticker"));
    // A second boot in the same process registers it again.
    clearBlocks();
    service.blockRegistry(ctx).register([block("acme/ticker")]);

    expect(getBlock("acme/ticker")).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"acme/ticker"');
    expect(String(warn.mock.calls[0]?.[0])).toContain("server only");
  });

  it("says nothing outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { ctx, warn } = contextFor();

    service.blockRegistry(ctx).register(block("acme/ticker"));

    expect(warn).not.toHaveBeenCalled();
  });

  it("says nothing about a declared block", () => {
    vi.stubEnv("NODE_ENV", "development");
    const { ctx, warn } = contextFor([
      {
        name: "@acme/blocks",
        contributes: {
          declarations: {
            [service.PAGE_BUILDER_PLUGIN]: { blocks: [block("acme/hero")] },
          },
        },
      },
    ]);

    service.registerDeclaredBlocks(ctx);

    expect(getBlock("acme/hero")).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a declared editor entry", () => {
  it("is refused at boot when it is not a component path", () => {
    const { ctx } = contextFor([
      {
        name: "@acme/blocks",
        contributes: {
          declarations: {
            [service.PAGE_BUILDER_PLUGIN]: {
              blocks: [block("acme/hero")],
              editorEntry: 42,
            },
          },
        },
      },
    ]);

    expect(() => service.registerDeclaredBlocks(ctx)).toThrow(/editorEntry/);
  });
});
