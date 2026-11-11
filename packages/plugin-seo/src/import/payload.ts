/**
 * Reading the values Payload's SEO plugin keeps, from a Payload export: the
 * JSON its import-export plugin writes, a list of documents (or `{ docs }`,
 * as its REST API answers), each with its `meta` group of `title`,
 * `description` and `image`. A document is matched by its address where it
 * has one, else by its slug.
 *
 * An export of every language holds each value per language; the language
 * being imported is read, and the others are said to be left out. An image
 * the export names only by its id there cannot be found here, so it needs
 * its address or file name. Pure.
 *
 * @module import/payload
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { isRecord } from "../plain-values";

import {
  count,
  idText,
  pathOfAddress,
  textValue,
  type ImageRef,
  type ImportedRecord,
  type ImportedValues,
  type ParsedSource,
} from "./records";

/** The documents an export holds, however it lists them. */
function documentsOf(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (isRecord(parsed) && Array.isArray(parsed.docs)) {
    return parsed.docs.filter(isRecord);
  }
  if (isRecord(parsed)) {
    // An export of several collections, by collection.
    const lists = Object.values(parsed).filter(Array.isArray);
    if (lists.length > 0) return lists.flat().filter(isRecord);
  }
  return [];
}

/**
 * A value as stored for one language: itself where it is not kept per
 * language, else the language's own, with whether it was kept per language.
 */
function inLanguage(
  value: unknown,
  locale: string | undefined
): { value: unknown; perLanguage: boolean } {
  if (!isRecord(value) || "url" in value || "filename" in value) {
    return { value, perLanguage: false };
  }
  const languages = Object.keys(value);
  const looksPerLanguage =
    languages.length > 0 &&
    languages.every(code => /^[a-z]{2,3}([-_][A-Za-z0-9]+)*$/.test(code));
  if (!looksPerLanguage) return { value, perLanguage: false };
  const chosen = locale ?? languages[0];
  return {
    value: chosen === undefined ? undefined : value[chosen],
    perLanguage: true,
  };
}

/** An image as the export names it, or none where it names it by id alone. */
function imageOf(value: unknown): ImageRef | "id" | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    return /^(https?:)?\//.test(text) ? { url: text } : "id";
  }
  if (!isRecord(value)) return undefined;
  const url = textValue(value.url);
  if (url !== undefined) return { url };
  const filename = textValue(value.filename);
  return filename === undefined ? "id" : { url: `/${filename}` };
}

/** What reading the documents noticed, for the dry run's warnings. */
interface Noticed {
  perLanguage: boolean;
  imagesById: number;
}

/** The export's text as JSON, or a refusal. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw NextlyError.invalidInput({
      message: "This isn't a Payload export: it isn't JSON.",
      logContext: { reason: "seo-import-payload-not-json" },
    });
  }
}

/** A document's `meta` group's values, in `locale`. */
function metaValuesOf(
  document: Record<string, unknown>,
  locale: string | undefined,
  from: ParsedSource["from"],
  noticed: Noticed
): ImportedValues {
  const meta = isRecord(document.meta) ? document.meta : {};
  const read = (name: string) => {
    const found = inLanguage(meta[name], locale);
    if (found.perLanguage) noticed.perLanguage = true;
    return found.value;
  };
  const values: ImportedValues = {};
  for (const name of ["title", "description"] as const) {
    const value = textValue(read(name));
    if (value === undefined) continue;
    values[name] = value;
    from[name] = [`meta.${name}`];
  }
  const image = imageOf(read("image"));
  if (image === "id") noticed.imagesById++;
  else if (image !== undefined) {
    values.image = image;
    from.image = ["meta.image"];
  }
  return values;
}

/** A document as a record, matched by its address or its slug. */
function recordOf(
  document: Record<string, unknown>,
  locale: string | undefined,
  values: ImportedValues
): ImportedRecord {
  const path = pathOfAddress(
    textValue(document.url) ?? textValue(document.path)
  );
  const slug = textValue(inLanguage(document.slug, locale).value);
  const ownTitle = textValue(inLanguage(document.title, locale).value);
  return {
    label: ownTitle ?? slug ?? path ?? idText(document.id) ?? "Untitled",
    match: {
      ...(path === undefined ? {} : { path }),
      ...(slug === undefined ? {} : { slug }),
    },
    values,
  };
}

/** What the person should know about what reading the export noticed. */
function warningsOf(noticed: Noticed, locale: string | undefined): string[] {
  const warnings: string[] = [];
  if (noticed.perLanguage) {
    warnings.push(
      `Payload stores one meta group per language; only ${locale ?? "the first language"} is imported from this file.`
    );
  }
  const n = noticed.imagesById;
  if (n > 0) {
    warnings.push(
      `${count(n, "share image")} ${n === 1 ? "is" : "are"} named only by Payload's id, which means nothing here, so ${n === 1 ? "it is" : "they are"} left out. Export with images included to bring them across.`
    );
  }
  return warnings;
}

/** Payload's SEO plugin's values from an export, in `locale`. */
export function readPayload(
  text: string,
  locale: string | undefined
): ParsedSource {
  const documents = documentsOf(parsedJson(text));
  if (documents.length === 0) {
    throw NextlyError.invalidInput({
      message: "This Payload export holds no documents.",
      logContext: { reason: "seo-import-payload-empty" },
    });
  }
  const from: ParsedSource["from"] = {};
  const noticed: Noticed = { perLanguage: false, imagesById: 0 };
  const records = documents.map(document =>
    recordOf(document, locale, metaValuesOf(document, locale, from, noticed))
  );
  return { records, from, left: [], warnings: warningsOf(noticed, locale) };
}
