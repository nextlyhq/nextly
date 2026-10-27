/**
 * The plugin template's Node floor is a precondition, so it runs before
 * anything is changed on disk: a developer whose Node is below it, scaffolding
 * into a directory that already has files and answering "remove", keeps those
 * files when the scaffold is refused.
 *
 * The flow runs for real with the prompts and the scaffold step replaced, and
 * the floor check answering as it does on an older Node.
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const select = vi.hoisted(() => vi.fn());
const cancel = vi.hoisted(() => vi.fn());
const copyTemplate = vi.hoisted(() => vi.fn(async () => {}));
const pluginNodeRefusal = vi.hoisted(() => vi.fn<() => string | undefined>());

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel,
  isCancel: () => false,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  log: {
    success: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
  select,
  text: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@nextlyhq/telemetry", () => ({
  capture: vi.fn(),
  classifyError: () => "unknown",
}));
vi.mock("../utils/template", () => ({ copyTemplate }));
vi.mock("../installers/dependencies", () => ({
  installDependencies: vi.fn(async () => {}),
}));
// The Node running this test is above the floor, so the check is made to
// answer as it does below it.
vi.mock("../utils/plugin-node", () => ({ pluginNodeRefusal }));

import { createNextly } from "../create-nextly";

describe("a plugin scaffold refused for its Node", () => {
  let cwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Error(`process.exit(${String(code)})`);
    });
    cwd = await mkdtemp(path.join(tmpdir(), "nextly-plugin-floor-"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true });
  });

  it("leaves a target the developer chose to clear as it was", async () => {
    const target = path.join(cwd, "my-plugin");
    await mkdir(target);
    await writeFile(path.join(target, "keep-me.txt"), "existing work");
    // The directory-conflict question, answered "remove".
    select.mockResolvedValueOnce("remove");
    pluginNodeRefusal.mockReturnValue(
      "this Node is below the plugin template's floor"
    );

    await expect(
      createNextly({
        cwd,
        projectType: "plugin",
        projectNameFromArg: "my-plugin",
        skipInstall: true,
      })
    ).rejects.toThrow("process.exit(1)");

    // The control: the conflict was asked and the refusal was shown, so the
    // run reached both and the files survived the order, not a skipped step.
    expect(String(select.mock.calls[0]?.[0]?.message)).toContain(
      "is not empty"
    );
    expect(cancel).toHaveBeenCalledWith(
      "this Node is below the plugin template's floor"
    );
    expect(await readdir(target)).toEqual(["keep-me.txt"]);
    expect(copyTemplate).not.toHaveBeenCalled();
  });

  // The control for the order: on a Node the template supports, "remove"
  // still clears the target before the template is written into it.
  it("clears the target as asked when the Node is supported", async () => {
    const target = path.join(cwd, "my-plugin");
    await mkdir(target);
    await writeFile(path.join(target, "old.txt"), "replace me");
    select.mockResolvedValueOnce("remove");
    pluginNodeRefusal.mockReturnValue(undefined);
    copyTemplate.mockImplementationOnce(async () => {
      expect(await readdir(target)).toEqual([]);
    });

    await createNextly({
      cwd,
      projectType: "plugin",
      projectNameFromArg: "my-plugin",
      skipInstall: true,
    });

    expect(copyTemplate).toHaveBeenCalledTimes(1);
  });
});
