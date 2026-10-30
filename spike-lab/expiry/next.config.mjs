// The lab's switches, read once at build and start:
// LAB_SHARED_LEDGER=1 puts the incremental cache behind ./cache-handler.mjs,
// whose tag expiries live in a file every instance and the CLI share.
import { fileURLToPath } from "node:url";

const shared = process.env.LAB_SHARED_LEDGER === "1";

export default {
  cacheComponents: true,
  ...(shared
    ? {
        cacheHandler: fileURLToPath(
          new URL("./cache-handler.mjs", import.meta.url)
        ),
        cacheMaxMemorySize: 0,
        cacheHandlers: {
          default: fileURLToPath(
            new URL("./use-cache-handler.mjs", import.meta.url)
          ),
        },
      }
    : {}),
};
