// Generate slug from name
export const generateSlug = (name: string) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^_+|_+$/g, "");
};

function isLikelyPlural(word: string): boolean {
  const lower = word.toLowerCase();

  const knownPlurals = [
    "people",
    "children",
    "men",
    "women",
    "teeth",
    "feet",
    "mice",
    "geese",
    "oxen",
    "sheep",
    "deer",
    "fish",
    "species",
    "series",
    "crises",
    "analyses",
    "theses",
    "phenomena",
    "criteria",
    "data",
    "alumni",
    "cacti",
    "fungi",
    "nuclei",
    "radii",
  ];

  if (knownPlurals.includes(lower)) return true;
  if (lower.endsWith("ies") || lower.endsWith("ves") || lower.endsWith("oes")) {
    return true;
  }
  if (lower.endsWith("en") && (lower === "oxen" || lower === "children")) {
    return true;
  }
  if (
    lower.endsWith("i") &&
    ["c", "g", "l", "r"].includes(lower.slice(-2, -1))
  ) {
    return true;
  }
  if (lower.endsWith("a") && ["n", "r"].includes(lower.slice(-2, -1))) {
    return true;
  }
  if (lower.length > 1 && lower.endsWith("s") && !isLikelySingular(lower)) {
    return true;
  }

  return false;
}

function isLikelySingular(word: string): boolean {
  const lower = word.toLowerCase();

  const singularEndings = [
    "ss",
    "us",
    "is",
    "os",
    "sis",
    "asis",
    "isis",
    "ysis",
    "tis",
    "itis",
    "esis",
  ];

  for (const ending of singularEndings) {
    if (lower.endsWith(ending)) return true;
  }

  const knownSingulars = [
    "glass",
    "class",
    "mass",
    "pass",
    "grass",
    "status",
    "atlas",
    "bus",
    "gas",
    "lens",
    "canvas",
    "process",
    "address",
    "access",
    "success",
    "princess",
    "actress",
    "hostess",
    "witness",
    "fortress",
    "express",
    "news",
  ];

  return knownSingulars.includes(lower);
}

function pluralizeSingleWord(word: string): string {
  const lower = word.toLowerCase();

  if (isLikelyPlural(word)) return word;

  const irregulars: Record<string, string> = {
    person: "people",
    man: "men",
    woman: "women",
    child: "children",
    tooth: "teeth",
    foot: "feet",
    mouse: "mice",
    goose: "geese",
    ox: "oxen",
    sheep: "sheep",
    deer: "deer",
    fish: "fish",
    species: "species",
    series: "series",
    crisis: "crises",
    analysis: "analyses",
    thesis: "theses",
    phenomenon: "phenomena",
    criterion: "criteria",
    datum: "data",
  };

  if (irregulars[lower]) return preserveCase(word, irregulars[lower]);

  if (lower.endsWith("y") && !/[aeiou]y$/i.test(lower)) {
    return word.slice(0, -1) + "ies";
  }
  if (
    lower.endsWith("s") ||
    lower.endsWith("x") ||
    lower.endsWith("z") ||
    lower.endsWith("ch") ||
    lower.endsWith("sh")
  ) {
    return word + "es";
  }
  return word + "s";
}

function preserveCase(original: string, plural: string): string {
  if (original === original.toUpperCase()) return plural.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return plural.charAt(0).toUpperCase() + plural.slice(1);
  }
  return plural;
}

export const simplePluralize = (name: string): string => {
  if (!name) return "";

  const trimmed = name.trim();
  if (!trimmed) return "";

  const words = trimmed.split(/\s+/);
  if (words.length > 1) {
    const lastWord = words[words.length - 1];
    const pluralizedLast = pluralizeSingleWord(lastWord);
    return [...words.slice(0, -1), pluralizedLast].join(" ");
  }

  return pluralizeSingleWord(trimmed);
};
