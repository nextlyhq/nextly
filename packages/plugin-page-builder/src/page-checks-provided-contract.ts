/**
 * What the editor sends the provided-checks route and what it answers:
 * every registered provider's findings about the page being edited. A
 * contract module, free of server code, so the editor's client reads it.
 *
 * @module page-checks-provided-contract
 */
import type {
  PageCheckFinding,
  PageCheckGroupName,
} from "@nextlyhq/plugin-sdk/blocks";

/** Where the editor asks for the providers' findings. */
export const PROVIDED_CHECKS_ROUTE_PATH = "/page-checks/provided";

/** The page asked about, as the editor holds it. */
export interface ProvidedChecksRequest {
  readonly collection: string;
  readonly entryId: string | null;
  readonly locale?: string;
  readonly document: unknown;
}

/** One provider's answer: its group, and what it found or that it didn't run. */
export interface ProvidedChecksItem {
  readonly provider: string;
  readonly group: PageCheckGroupName;
  /** False where the provider threw or took too long; its findings are empty. */
  readonly ran: boolean;
  readonly findings: readonly PageCheckFinding[];
}
