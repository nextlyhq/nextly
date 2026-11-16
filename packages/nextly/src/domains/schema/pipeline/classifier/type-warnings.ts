// What each database does with one type change, said for the pair of types it is.
//
// Returned per type_change event, one line per dialect: the prompt shows the line of the database
// being changed, and the legacy preview reads its own. Each line says what that database actually
// does with the values, which depends on the pair: a PostgreSQL cast stops at the first value it
// cannot read and rolls back, MySQL refuses a value that is not JSON whatever its SQL mode (and in
// strict mode, its default, any value it cannot convert), and SQLite applies its new affinity,
// checking nothing. The pair's family is read by the one rule a conversion is judged by
// (`value-conversion/column-type`), so a type spelled `int4` or `integer` gets the same line.

import { parseColumnType } from "../../value-conversion/column-type";

const STRINGS = new Set(["text", "varchar", "char"]);
const NUMBERS = new Set(["int2", "int4", "int8", "numeric"]);

/** The three lines for one pair, before each names its database and the pair. */
interface PairWarning {
  pg: string;
  mysql: string;
  sqlite: string;
}

const STOPS_AND_KEEPS = "and nothing is changed.";

/** What each database does with the pair `fromType` -> `toType`. */
function pairWarning(fromType: string, toType: string): PairWarning {
  const from = parseColumnType({ type: fromType, nullable: true });
  const to = parseColumnType({ type: toType, nullable: true });

  if (STRINGS.has(from.family) && to.family === "json") {
    return {
      pg: `stops with an error at the first value that is not JSON (an empty string included), ${STOPS_AND_KEEPS}`,
      mysql:
        "refuses a value that is not valid JSON (an empty string included), whatever the SQL mode: it is not coerced. The conversion stops and nothing is changed.",
      sqlite:
        "keeps every value as it is: SQLite holds JSON as text, so no value is checked.",
    };
  }
  if (STRINGS.has(from.family) && to.length !== undefined) {
    const limit = String(to.length);
    return {
      pg: `stops with an error at the first value longer than ${limit} characters, ${STOPS_AND_KEEPS}`,
      mysql: `refuses a value longer than ${limit} characters in strict mode (the default), and the conversion stops; without strict mode it cuts the value to ${limit} characters with only a warning.`,
      sqlite: "keeps every value as it is: SQLite enforces no length.",
    };
  }
  if (NUMBERS.has(from.family) && to.family === "float8") {
    const rounded =
      "a value of more than 15 significant digits is rounded, with no error";
    return {
      pg: `stores each value as a double: ${rounded}.`,
      mysql: `stores each value as a double: ${rounded}.`,
      sqlite: `stores each number as a REAL, a double: ${rounded}, and a value that is not a number is kept as text.`,
    };
  }
  return {
    pg: `stops with an error at the first value that cannot be cast to ${toType}, ${STOPS_AND_KEEPS}`,
    mysql:
      "refuses a value it cannot convert in strict mode (the default), and the conversion stops; without strict mode it stores a coerced value (0, a cut string, a zero date) with only a warning.",
    sqlite:
      'copies each value into a column of the new type\'s affinity: a value it cannot convert is kept as it was stored ("abc" stays text in an integer column), with no error.',
  };
}

export function buildPerDialectWarning(
  fromType: string,
  toType: string
): { pg: string; mysql: string; sqlite: string } {
  const change = `${fromType} -> ${toType}`;
  const warning = pairWarning(fromType, toType);
  return {
    pg: `PostgreSQL: ${change} ${warning.pg}`,
    mysql: `MySQL: ${change} ${warning.mysql}`,
    sqlite: `SQLite: ${change} ${warning.sqlite}`,
  };
}
