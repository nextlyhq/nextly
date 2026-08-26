/**
 * The wire shape a rename candidate takes on its way to a client.
 *
 * ONE mapping, because two dispatchers answer the same question about the same
 * object and a field added to one of them is a field the other silently stops
 * sending. That is not hypothetical here: `preservesValues` is the field whose
 * absence let a value-converting rename be offered as "data preserved", and
 * adding it in two places is how the next one goes missing from one surface.
 *
 * The names differ from the candidate's own (`table` rather than `tableName`)
 * because the wire shape predates this and clients read it.
 *
 * @module domains/schema/pipeline/rename-candidate-wire
 */

import type { RenameCandidate } from "./pushschema-pipeline-interfaces";

export interface RenameCandidateWire {
  table: string;
  from: string;
  to: string;
  fromType: string;
  toType: string;
  typesCompatible: boolean;
  preservesValues: boolean;
  valueChangeReason?: string;
  defaultSuggestion: "rename" | "drop_and_add";
}

export function toRenameCandidateWire(
  candidate: RenameCandidate
): RenameCandidateWire {
  return {
    table: candidate.tableName,
    from: candidate.fromColumn,
    to: candidate.toColumn,
    fromType: candidate.fromType,
    toType: candidate.toType,
    typesCompatible: candidate.typesCompatible,
    preservesValues: candidate.preservesValues,
    valueChangeReason: candidate.valueChangeReason,
    defaultSuggestion: candidate.defaultSuggestion,
  };
}
