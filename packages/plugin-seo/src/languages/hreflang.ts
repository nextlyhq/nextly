/**
 * The language codes search engines accept in language links: a language
 * from ISO 639-1, optionally with a script from ISO 15924 and a region from
 * ISO 3166-1 alpha-2, such as `de`, `pt-BR` or `zh-Hant-TW`.
 *
 * A site's language is mapped to that form where it names one under another
 * spelling (`pt_br`, the three-letter `deu`, the retired `iw`, the region
 * `UK` for `GB`), and refused where it names none, such as `es-419`, whose
 * region is a UN M.49 number, or a code of the site's own making. A refused
 * language is left out of every language link, and is a problem the site's
 * language settings fix.
 *
 * Pure.
 *
 * @module languages/hreflang
 */

/** ISO 639-1: every two-letter language code. */
const LANGUAGES = new Set(
  (
    "aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch " +
    "co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy " +
    "ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it " +
    "iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo " +
    "lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny " +
    "oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl " +
    "sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty " +
    "ug uk ur uz ve vi vo wa wo xh yi yo za zh zu"
  ).split(" ")
);

/** ISO 3166-1 alpha-2: every assigned two-letter region code. */
const REGIONS = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI " +
    "BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN " +
    "CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK " +
    "FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
    "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
    "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
    "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP " +
    "NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF " +
    "TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
    "VN VU WF WS YE YT ZA ZM ZW"
  ).split(" ")
);

/** How many codes each list holds, as the two standards assign them. */
export const ISO_639_1_COUNT: number = LANGUAGES.size;
export const ISO_3166_1_COUNT: number = REGIONS.size;

/**
 * A site language as a language link names it: `accepted` as it is spelled
 * (in any case, since search engines read the code without regard to case),
 * `mapped` from another spelling of the same language, or `refused`.
 */
export type Hreflang =
  | { status: "accepted"; code: string }
  | { status: "mapped"; code: string }
  | { status: "refused" };

const REFUSED: Hreflang = { status: "refused" };

/**
 * The code `language` is named by in a language link. Each part is checked
 * against its standard after the language is put in its canonical form, so
 * a retired or three-letter code reaches the two-letter one it stands for,
 * and a variant, an extension or a part of no standard is refused.
 */
export function hreflangOf(language: string): Hreflang {
  const spelled = language.trim();
  if (spelled === "") return REFUSED;
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(spelled.replace(/_/g, "-"));
  } catch {
    return REFUSED;
  }
  const code = locale.toString();
  // Only a language, a script and a region: anything after them (a variant
  // such as `1996`, or a `-u-` extension) is not part of what is accepted.
  const parts = [locale.language, locale.script, locale.region].filter(
    (part): part is string => part !== undefined
  );
  if (code !== parts.join("-")) return REFUSED;
  if (!LANGUAGES.has(locale.language)) return REFUSED;
  if (locale.region !== undefined && !REGIONS.has(locale.region)) {
    return REFUSED;
  }
  return code.toLowerCase() === spelled.toLowerCase()
    ? { status: "accepted", code }
    : { status: "mapped", code };
}

/**
 * A site language left out of language links: its code is one search
 * engines do not accept (`code`), or another of the site's languages is
 * named by the same code (`same-code`). Fixed in the site's language
 * settings.
 */
export interface LanguageCodeProblem {
  /** The site's language, as the site spells it. */
  language: string;
  detail: "code" | "same-code";
  /** What the problem list shows. */
  message: string;
  fix: "settings";
  /** The language the code is already taken by, for `same-code`. */
  sameAs?: string;
}

/**
 * The code each of `languages` is named by in language links, in order, and
 * a problem for each one left out: refused, or named by a code an earlier
 * language already took. List the default language first, so it keeps its
 * code.
 */
export function hreflangCodes(languages: readonly string[]): {
  codes: Map<string, string>;
  problems: LanguageCodeProblem[];
} {
  const codes = new Map<string, string>();
  const takenBy = new Map<string, string>();
  const problems: LanguageCodeProblem[] = [];
  for (const language of languages) {
    if (codes.has(language)) continue;
    const named = hreflangOf(language);
    if (named.status === "refused") {
      problems.push({
        language,
        detail: "code",
        message: `"${language}" is not a language code search engines accept, so its pages have no language links. Use an ISO 639-1 language, with an ISO 3166-1 region where needed, such as "de" or "pt-BR".`,
        fix: "settings",
      });
      continue;
    }
    // Compared without regard to case, as search engines read the code.
    const key = named.code.toLowerCase();
    const other = takenBy.get(key);
    if (other !== undefined) {
      problems.push({
        language,
        detail: "same-code",
        message: `"${language}" and "${other}" are both "${named.code}" to search engines, so "${language}" has no language links. Give each language its own code.`,
        fix: "settings",
        sameAs: other,
      });
      continue;
    }
    takenBy.set(key, language);
    codes.set(language, named.code);
  }
  return { codes, problems };
}
