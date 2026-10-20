import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { BaseService } from "../../shared/base-service";
import type { Logger } from "../../shared/types";

import type { StoredFileSearch } from "./remove-stored-files";

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
      read: where =>
        this.db
          .select({
            filename: media.filename,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl,
            sizes: media.sizes,
          })
          .from(media)
          .where(where),
    };
  }
}
