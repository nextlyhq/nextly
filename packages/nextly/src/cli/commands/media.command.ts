/**
 * `nextly media`, declared: its subcommands, arguments, options and help. Each
 * action is loaded from `./media` when it runs, so declaring the command loads
 * none of the media, storage or database code.
 *
 * @module cli/commands/media.command
 */
import { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/**
 * `nextly media orphans [--apply]`: finds, and with --apply removes, the
 * upload-time thumbnails deletes before this release left in the media
 * storage, still publicly served. A dry run by default.
 *
 * `nextly media remove-sizes [--apply] [--drop]`: lists, and with --apply
 * removes, the image size files items stored before sizes were removed, then
 * clears each item's sizes; with --drop as well it then drops the column and
 * the table. A dry run by default.
 *
 * `nextly media reindex-usage`: rebuilds the record of where each media item
 * is used from the stored content, for an install whose content predates the
 * record and after a restore.
 */
export function createMediaCommand(): Command {
  const media = new Command("media").description(
    "Work with the media library's stored files"
  );
  media
    .command("orphans")
    .description(
      "List upload-time thumbnails no media item refers to; remove them with --apply"
    )
    .option("--apply", "Remove the thumbnails listed", false)
    .action(
      lazyAction(async () => (await import("./media")).mediaOrphansAction)
    );
  media
    .command("remove-sizes")
    .description(
      "List the image size files stored before sizes were removed; remove them and clear each item's sizes with --apply; then drop the sizes column and the image_sizes table with --apply --drop"
    )
    .option("--apply", "Remove the size files listed", false)
    .option(
      "--drop",
      "With --apply, once no item names a size file, drop the media table's sizes column and the image_sizes table",
      false
    )
    .action(
      lazyAction(async () => (await import("./media")).mediaRemoveSizesAction)
    );
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    media
      .command("reindex-usage")
      .description(
        "Rebuild the record of where each media item is used, from the stored content"
      )
  ).action(
    lazyAction(async () => (await import("./media")).mediaReindexUsageAction)
  );
  return media;
}
