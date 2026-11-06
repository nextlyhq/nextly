import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { BaseService } from "../../shared/base-service";
import type { Logger } from "../../shared/types";

import type { StoredFileSearch } from "./remove-stored-files";
import { RETIRED_SIZES_COLUMN } from "./retired-image-sizes-constants";
import { hasRetiredSizesColumn } from "./retired-image-sizes-store";

/**
 * How the media table is read for the rows that may share a stored file
 * (`filesKeptByOthers`): the one reader every delete, crop and the
 * `media orphans` command asks through.
 */
export class StoredFileSearchReader extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  get search(): StoredFileSearch {
    const { media } = this.tables;
    return {
      columns: media,
      dialect: this.dialect,
      // The retired `sizes` column is not in the Drizzle definition, so it is
      // named by its quoted identifier, and only while the database has it.
      sizesColumn: async () =>
        (await hasRetiredSizesColumn(this.db, this.dialect))
          ? sql`${sql.identifier(RETIRED_SIZES_COLUMN)}`
          : undefined,
      read: (where, sizes) =>
        this.db
          .select({
            filename: media.filename,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl,
            ...(sizes === undefined ? {} : { sizes: sql<unknown>`${sizes}` }),
          })
          .from(media)
          .where(where),
    };
  }
}
