/**
 * The two writers a seeder reports through, silent or masked.
 *
 * A seeding line can name the account it is working on, so it goes through
 * the masked console logger rather than the console. A silent seed writes
 * nothing.
 */

import { consoleLogger } from "../../shared/types";

export interface SeederLog {
  log: (message: string) => void;
  errorLog: (message: string) => void;
}

const SILENT: SeederLog = { log: () => {}, errorLog: () => {} };

export function seederLog(silent: boolean): SeederLog {
  if (silent) return SILENT;
  return {
    log: message => consoleLogger.info(message),
    errorLog: message => consoleLogger.error(message),
  };
}
