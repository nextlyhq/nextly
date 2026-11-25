/**
 * The language a migration file's answers are decided in, judged before a run's first statement.
 *
 * An answer for a field kept per language fills, or deletes, the entries with no value in the
 * default language, and its statements hold that language as it was when the file was written.
 * Where the database's default is another one, the same statements settle other rows: a delete
 * removes entries complete in this default, a fill writes another language's rows. So a run refuses
 * such a file, naming both languages, and one that holds an answer and records no language; where
 * the answer has no entry to settle (`answered-entries`), the file runs whatever its language.
 *
 * @module domains/i18n/migration/answer-language
 */
import { NextlyError } from "../../../errors/nextly-error";
import { splitSqlStatements } from "../../schema/migrate/split-sql";
import { settledTablesOf } from "../../schema/pipeline/sql-templates/resolution-statements";
import { standardLanguageCode } from "../config/standard-code";

import { ANSWERS_HEADER } from "./answer-language-names";
import { type AnswerRun, mayHaveEntriesToSettle } from "./answered-entries";
import { headerLines } from "./migration-intent";

/** A migration file as this judges it. */
interface AnsweringFile {
  name: string;
  upSql: string;
  transaction: boolean;
  /** The language its header records (`recordedAnswerLanguage`). */
  answersIn?: string;
}

/** A file a run refuses, and why, as a sentence. */
export interface AnswerLanguageRefusal {
  file: string;
  message: string;
  /** The language the file answers in, or none where it records none. */
  answersIn: string | undefined;
}

/**
 * The language a file's header records for its answers, or none where it records none. Only the
 * header is read: the same words in a statement, such as a fill's text, record nothing.
 */
export function recordedAnswerLanguage(content: string): string | undefined {
  const line = headerLines(content).find(each =>
    each.startsWith(`${ANSWERS_HEADER} `)
  );
  return line?.slice(ANSWERS_HEADER.length).trim() || undefined;
}

const standard = (code: string) => standardLanguageCode(code) ?? code;

/** The refusal of a file answered in another language than `runsIn`, or in none it records. */
export function answerLanguageRefusal(
  file: Pick<AnsweringFile, "name" | "answersIn">,
  runsIn: string
): AnswerLanguageRefusal {
  const { name, answersIn } = file;
  const message =
    answersIn === undefined
      ? `it fills or deletes entries by their default language's values, and records no language they are decided in; this project's default language is "${runsIn}".`
      : `its answers are decided in "${answersIn}", and this project's default language is "${runsIn}".`;
  return { file: `${name}.sql`, message, answersIn };
}

/**
 * Those of `files` whose answers are decided in another language than `defaultLanguage` gives, or
 * that record none, and may have an entry to settle in the database `run` starts from.
 * `defaultLanguage` is asked only where a file holds an answer, and the entries only where its
 * language differs.
 */
export async function answerLanguageRefusals(
  files: readonly AnsweringFile[],
  run: AnswerRun,
  defaultLanguage: () => Promise<string>
): Promise<{ refusals: AnswerLanguageRefusal[]; runsIn: string | undefined }> {
  const answering = files.filter(
    file =>
      file.answersIn !== undefined ||
      splitSqlStatements(file.upSql, run.dialect, file).some(
        statement => settledTablesOf(statement) !== undefined
      )
  );
  if (answering.length === 0) return { refusals: [], runsIn: undefined };
  const runsIn = standard(await defaultLanguage());
  const refusals: AnswerLanguageRefusal[] = [];
  for (const file of answering) {
    const { answersIn } = file;
    if (answersIn !== undefined && standard(answersIn) === runsIn) continue;
    if (await mayHaveEntriesToSettle(file, run)) {
      refusals.push(answerLanguageRefusal(file, runsIn));
    }
  }
  return { runsIn, refusals };
}

/**
 * Refuses a run over a file whose answers are decided in another language, or that records none,
 * before any of its statements (`answerLanguageRefusals`).
 *
 * @throws NextlyError `CONFLICT`, its reason `ANSWER_LANGUAGE_REASON`, its parts the CLI's
 */
export async function refuseAnswersInAnotherLanguage(
  files: readonly AnsweringFile[],
  run: AnswerRun,
  defaultLanguage: () => Promise<string>
): Promise<void> {
  const { refusals, runsIn } = await answerLanguageRefusals(
    files,
    run,
    defaultLanguage
  );
  if (refusals.length === 0 || runsIn === undefined) return;
  throw answerLanguageError(refusals, runsIn);
}

/**
 * The refusal of files whose answers are not recorded as decided in the language the database's
 * default is: what each records, why it matters, and the ways out. Laid out as three sentences,
 * kept in the log context as its parts for the CLI's error shape.
 */
export function answerLanguageError(
  refusals: readonly AnswerLanguageRefusal[],
  runsIn: string
): NextlyError {
  const languages = [
    ...new Set(refusals.flatMap(refusal => refusal.answersIn ?? [])),
  ];
  const one = refusals.length === 1;
  const what = `${one ? "A migration's" : `${refusals.length} migrations'`} answers are not recorded as decided in this project's default language, "${runsIn}".`;
  const why = [
    ...refusals.map(refusal => `${refusal.file}: ${refusal.message}`),
    `Run here, ${one ? "its" : "their"} statements would settle other entries than the ones answered for. Nothing was changed.`,
  ].join("\n");
  const them = one ? "it" : "them";
  const again = `Where no environment has applied ${them}, delete ${them} and make the save again with "${runsIn}" as the default language.`;
  const [language, ...others] = languages;
  const asWritten =
    language === undefined
      ? ""
      : others.length === 0
        ? ` Where one has, make "${language}" the default language here, run \`nextly migrate\`, then make "${runsIn}" the default again.`
        : ` Where one has, run each with its own language as the default here (\`nextly migrate --step 1\`), then make "${runsIn}" the default again.`;
  const next = `${again}${asWritten}`;
  return NextlyError.conflict({
    reason: "state",
    message: `${what} ${why} ${next}`,
    logContext: {
      // Spelt out, as `ANSWER_LANGUAGE_REASON` holds it, for the CLI's mapping.
      reason: "migration answers in another language",
      files: refusals.map(refusal => refusal.file),
      parts: { what, why, next },
    },
  });
}
