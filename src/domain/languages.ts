/**
 * The languages the popup's "Spoken language" setting offers, by ISO 639-1 code: Whisper's 99,
 * less the two Whisper names by codes that aren't ISO 639-1 (Javanese "jw", Hawaiian "haw"),
 * which Groq, which asks for ISO 639-1, may not take. Detection still covers all 99. Cantonese
 * ("yue") is left out because only the large-v3 models know it.
 * See docs/adr/0016-transcription-detects-the-spoken-language.md.
 */
export const SPOKEN_LANGUAGES = [
  "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca", "cs", "cy", "da",
  "de", "el", "en", "es", "et", "eu", "fa", "fi", "fo", "fr", "gl", "gu", "ha", "he", "hi", "hr",
  "ht", "hu", "hy", "id", "is", "it", "ja", "ka", "kk", "km", "kn", "ko", "la", "lb", "ln", "lo",
  "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc",
  "pa", "pl", "ps", "pt", "ro", "ru", "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su",
  "sv", "sw", "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "yi", "yo",
  "zh",
] as const;

export type SpokenLanguage = (typeof SPOKEN_LANGUAGES)[number];

/**
 * Each language by its own name (its endonym), which the menu shows beside the name in the UI's
 * language: a speaker looks for the name they write, whatever language the browser is in. From CLDR 47 (Node’s ICU), with the first
 * letter capitalized for a menu (not Georgian, which has no capitals in running text, nor chiShona,
 * whose prefix stays lowercase). CLDR has none for Bashkir, Haitian Creole or Latin, and calls
 * Tagalog Filipino; those four are filled in, and Indonesian and Malay use their usual full names.
 */
export const SPOKEN_LANGUAGE_NAMES: Record<SpokenLanguage, string> = {
  af: "Afrikaans",
  am: "አማርኛ",
  ar: "العربية",
  as: "অসমীয়া",
  az: "Azərbaycan",
  ba: "Башҡорт теле",
  be: "Беларуская",
  bg: "Български",
  bn: "বাংলা",
  bo: "བོད་སྐད་",
  br: "Brezhoneg",
  bs: "Bosanski",
  ca: "Català",
  cs: "Čeština",
  cy: "Cymraeg",
  da: "Dansk",
  de: "Deutsch",
  el: "Ελληνικά",
  en: "English",
  es: "Español",
  et: "Eesti",
  eu: "Euskara",
  fa: "فارسی",
  fi: "Suomi",
  fo: "Føroyskt",
  fr: "Français",
  gl: "Galego",
  gu: "ગુજરાતી",
  ha: "Hausa",
  he: "עברית",
  hi: "हिन्दी",
  hr: "Hrvatski",
  ht: "Kreyòl ayisyen",
  hu: "Magyar",
  hy: "Հայերեն",
  id: "Bahasa Indonesia",
  is: "Íslenska",
  it: "Italiano",
  ja: "日本語",
  ka: "ქართული",
  kk: "Қазақ тілі",
  km: "ខ្មែរ",
  kn: "ಕನ್ನಡ",
  ko: "한국어",
  la: "Latina",
  lb: "Lëtzebuergesch",
  ln: "Lingála",
  lo: "ລາວ",
  lt: "Lietuvių",
  lv: "Latviešu",
  mg: "Malagasy",
  mi: "Māori",
  mk: "Македонски",
  ml: "മലയാളം",
  mn: "Монгол",
  mr: "मराठी",
  ms: "Bahasa Melayu",
  mt: "Malti",
  my: "မြန်မာ",
  ne: "नेपाली",
  nl: "Nederlands",
  nn: "Norsk nynorsk",
  no: "Norsk",
  oc: "Occitan",
  pa: "ਪੰਜਾਬੀ",
  pl: "Polski",
  ps: "پښتو",
  pt: "Português",
  ro: "Română",
  ru: "Русский",
  sa: "संस्कृत भाषा",
  sd: "سنڌي",
  si: "සිංහල",
  sk: "Slovenčina",
  sl: "Slovenščina",
  sn: "chiShona",
  so: "Soomaali",
  sq: "Shqip",
  sr: "Српски",
  su: "Basa Sunda",
  sv: "Svenska",
  sw: "Kiswahili",
  ta: "தமிழ்",
  te: "తెలుగు",
  tg: "Тоҷикӣ",
  th: "ไทย",
  tk: "Türkmen dili",
  tl: "Tagalog",
  tr: "Türkçe",
  tt: "Татар",
  uk: "Українська",
  ur: "اردو",
  uz: "O‘zbek",
  vi: "Tiếng Việt",
  yi: "ייִדיש",
  yo: "Èdè Yorùbá",
  zh: "中文",
};

/** A row of the Spoken language menu. `endonym` is null where it would repeat `name`. */
export type SpokenLanguageOption = { code: SpokenLanguage; name: string; endonym: string | null };

/** CLDR names languages in lowercase in many locales (español, français), as in running text. */
const capitalize = (text: string, locale: string): string => {
  const [first = "", ...rest] = text;
  return `${first.toLocaleUpperCase(locale)}${rest.join("")}`;
};

/**
 * The menu's rows for a UI in `locale` (a BCP 47 tag): each language by its name in that locale,
 * with its endonym beside it, in that locale's order of the first name, so a reader finds a
 * language under the word they know it by. The first name is the browser's CLDR data
 * (`Intl.DisplayNames`), capitalized for a menu; a language it has no name for is listed by its
 * endonym alone. See docs/adr/0020-spoken-languages-named-in-the-ui-language-too.md.
 */
export const spokenLanguageOptions = (locale: string): SpokenLanguageOption[] => {
  const displayNames = new Intl.DisplayNames(locale, { type: "language", fallback: "none" });
  const { compare } = new Intl.Collator(locale);
  return SPOKEN_LANGUAGES.map((code) => {
    const endonym = SPOKEN_LANGUAGE_NAMES[code];
    const localName = displayNames.of(code);
    const name = localName ? capitalize(localName, locale) : endonym;
    return { code, name, endonym: name === endonym ? null : endonym };
  }).sort((a, b) => compare(a.name, b.name));
};

/** Storage and popup requests are untrusted input: only a listed code passes. */
export const isSpokenLanguage = (value: unknown): value is SpokenLanguage =>
  typeof value === "string" && (SPOKEN_LANGUAGES as readonly string[]).includes(value);
