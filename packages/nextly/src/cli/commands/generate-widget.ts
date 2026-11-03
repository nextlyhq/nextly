/**
 * `nextly generate:widget [id]`: scaffolds a working dashboard widget in the
 * site or plugin it runs in, a declaration, a component for a view of its own,
 * and a test, and lists it where its owner lists widgets.
 *
 * @module cli/commands/generate-widget
 *
 * @example
 * ```bash
 * nextly generate:widget open-orders
 * nextly generate:widget site/open-orders --view list --collection
 * nextly generate:widget acme/open-orders --view component --dry-run
 * ```
 */
import * as clack from "@clack/prompts";
import type { Command } from "commander";

import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { createContext, type CommandContext } from "../context";
import { exitWithError } from "../errors";
import {
  widgetGenerateCancelled,
  widgetNotGenerated,
} from "../errors/areas/commands";
import { answered as answeredOrCancelled } from "../utils/prompt-cancelled";

import type { WidgetViewKind } from "./generate-widget/files";
import {
  runGenerateWidget,
  type GenerateWidgetOptions,
  type GenerateWidgetResult,
  type WidgetPrompter,
} from "./generate-widget/run";

/**
 * A cancelled prompt stops the command; nothing has been written by then. It says so in the
 * shape, under its own code, and the run ends as interrupted, exit 130 (`promptCancelled`).
 */
function answered<T>(value: T | symbol): Promise<T> {
  if (clack.isCancel(value)) clack.cancel("Nothing written.");
  return answeredOrCancelled(value, widgetGenerateCancelled());
}

/** Asks on a terminal through @clack/prompts, as the CLI's other questions do. */
const terminalPrompter: WidgetPrompter = {
  async id() {
    return answered(
      await clack.text({
        message: "The widget's name (or <namespace>/<name>)",
        placeholder: "open-orders",
      })
    );
  },
  async view(kinds) {
    return answered(
      await clack.select<WidgetViewKind>({
        message: "How it shows its data",
        options: kinds.map(kind => ({ value: kind, label: kind })),
        initialValue: "figure",
      })
    );
  },
  async collection() {
    return answered(
      await clack.confirm({
        message: "Read from a collection the reader chooses?",
        initialValue: false,
      })
    );
  },
};

function report(
  result: Extract<GenerateWidgetResult, { ok: true }>,
  { logger }: CommandContext
): void {
  const verb = result.written ? "Wrote" : "Would write";
  for (const file of result.files) logger.success(`${verb} ${file.path}`);
  for (const edit of result.edits) {
    logger.success(`${result.written ? "Edited" : "Would edit"} ${edit.path}`);
    if (!result.written) {
      logger.info(edit.after);
    }
  }
  for (const step of result.manual) logger.warn(step);
  logger.newline();
  logger.header("Next");
  for (const step of result.nextSteps) logger.item(step);
}

interface GenerateWidgetFlags {
  view?: string;
  collection?: boolean;
  site?: boolean;
  plugin?: boolean;
  overwrite?: boolean;
  /** The earlier spelling of `--overwrite`, honoured with a notice. */
  force?: boolean;
  dryRun?: boolean;
}

/** The action of `nextly generate:widget`, loaded when it runs. */
export async function generateWidgetAction(
  id: string | undefined,
  flags: GenerateWidgetFlags,
  cmd: Command
) {
  const context = createContext(cmd.optsWithGlobals());
  if (flags.force) {
    context.logger.warn(
      "generate:widget's --force is deprecated and will be removed: use --overwrite."
    );
  }
  const options: GenerateWidgetOptions = {
    id,
    view: flags.view,
    collection: flags.collection,
    target: flags.site ? "site" : flags.plugin ? "plugin" : undefined,
    overwrite: flags.overwrite === true || flags.force === true,
    dryRun: flags.dryRun,
    // The root CLI's `-c, --config`, which names the site's config.
    configPath: context.configPath,
  };
  try {
    const result = await runGenerateWidget(
      context.cwd,
      options,
      // Asked only where a person can answer: a terminal, `CI` unset, and no
      // `--non-interactive`.
      canPrompt() ? terminalPrompter : undefined
    );
    // A refusal of what it was given; the catch prints it as the CLI's error shape.
    if (!result.ok) throw widgetNotGenerated(result.reason);
    report(result, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
