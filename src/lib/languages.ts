// Languages offered for transcription and for the notes (ISO-639-1 codes).
//
// OpenAI's transcription models handle these with good accuracy. The ones
// marked `limited` are understood too, but OpenAI warns that quality is lower
// for languages outside its main list. Sinhala is one of them.
//
// `script` is set for languages that aren't written in the Latin alphabet:
// the transcriber is told to write them in that script (and to keep English
// words in English), so a Sinhala lecture comes back as සිංහල rather than
// romanised or translated.

export interface Language {
  code: string;
  /** English name, for sorting and for the AI's instructions. */
  name: string;
  /** The language's own name for itself. */
  native: string;
  script?: string;
  limited?: boolean;
}

export const LANGUAGES: Language[] = [
  { code: 'af', name: 'Afrikaans', native: 'Afrikaans' },
  { code: 'sq', name: 'Albanian', native: 'Shqip', limited: true },
  { code: 'am', name: 'Amharic', native: 'አማርኛ', script: 'Ethiopic (Ge’ez)', limited: true },
  { code: 'ar', name: 'Arabic', native: 'العربية', script: 'Arabic' },
  { code: 'hy', name: 'Armenian', native: 'Հայերեն', script: 'Armenian' },
  { code: 'az', name: 'Azerbaijani', native: 'Azərbaycanca' },
  { code: 'eu', name: 'Basque', native: 'Euskara', limited: true },
  { code: 'be', name: 'Belarusian', native: 'Беларуская', script: 'Cyrillic' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', script: 'Bengali', limited: true },
  { code: 'bs', name: 'Bosnian', native: 'Bosanski' },
  { code: 'bg', name: 'Bulgarian', native: 'Български', script: 'Cyrillic' },
  { code: 'my', name: 'Burmese', native: 'မြန်မာ', script: 'Myanmar', limited: true },
  { code: 'ca', name: 'Catalan', native: 'Català' },
  { code: 'zh', name: 'Chinese', native: '中文', script: 'Chinese characters' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'gl', name: 'Galician', native: 'Galego' },
  { code: 'ka', name: 'Georgian', native: 'ქართული', script: 'Georgian', limited: true },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά', script: 'Greek' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', script: 'Gujarati', limited: true },
  { code: 'ha', name: 'Hausa', native: 'Hausa', limited: true },
  { code: 'he', name: 'Hebrew', native: 'עברית', script: 'Hebrew' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', script: 'Devanagari' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'is', name: 'Icelandic', native: 'Íslenska' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ja', name: 'Japanese', native: '日本語', script: 'Japanese' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', script: 'Kannada' },
  { code: 'kk', name: 'Kazakh', native: 'Қазақ тілі', script: 'Cyrillic' },
  { code: 'km', name: 'Khmer', native: 'ខ្មែរ', script: 'Khmer', limited: true },
  { code: 'ko', name: 'Korean', native: '한국어', script: 'Hangul' },
  { code: 'lo', name: 'Lao', native: 'ລາວ', script: 'Lao', limited: true },
  { code: 'la', name: 'Latin', native: 'Latina', limited: true },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lb', name: 'Luxembourgish', native: 'Lëtzebuergesch', limited: true },
  { code: 'mk', name: 'Macedonian', native: 'Македонски', script: 'Cyrillic' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', script: 'Malayalam', limited: true },
  { code: 'mt', name: 'Maltese', native: 'Malti', limited: true },
  { code: 'mi', name: 'Maori', native: 'Te Reo Māori' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', script: 'Devanagari' },
  { code: 'mn', name: 'Mongolian', native: 'Монгол', script: 'Cyrillic', limited: true },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', script: 'Devanagari' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'ps', name: 'Pashto', native: 'پښتو', script: 'Arabic', limited: true },
  { code: 'fa', name: 'Persian', native: 'فارسی', script: 'Persian (Arabic)' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', script: 'Gurmukhi', limited: true },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'ru', name: 'Russian', native: 'Русский', script: 'Cyrillic' },
  { code: 'sr', name: 'Serbian', native: 'Српски', script: 'Cyrillic' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල', script: 'Sinhala', limited: true },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'so', name: 'Somali', native: 'Soomaali', limited: true },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', script: 'Tamil' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', script: 'Telugu', limited: true },
  { code: 'th', name: 'Thai', native: 'ไทย', script: 'Thai' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', script: 'Cyrillic' },
  { code: 'ur', name: 'Urdu', native: 'اردو', script: 'Urdu (Arabic)' },
  { code: 'uz', name: 'Uzbek', native: 'Oʻzbekcha', limited: true },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'cy', name: 'Welsh', native: 'Cymraeg' },
  { code: 'yo', name: 'Yoruba', native: 'Yorùbá', limited: true },
];

export function getLanguage(code: string | undefined): Language | undefined {
  return code ? LANGUAGES.find((l) => l.code === code) : undefined;
}

/** "Sinhala · සිංහල", or just "German" when the two names are the same. */
export function languageLabel(l: Language): string {
  return l.native && l.native !== l.name ? `${l.name} · ${l.native}` : l.name;
}

/** Options for a language picker, after `first` (e.g. Auto-detect / Use default). */
export function languageOptions(first: { value: string; label: string; description?: string }[]) {
  return [
    ...first,
    ...LANGUAGES.map((l) => ({
      value: l.code,
      label: languageLabel(l),
      description: l.limited ? 'Supported, but less accurate' : undefined,
    })),
  ];
}

/** The languages to tell the transcriber about: the chosen one, plus English when it's another language (speakers mix in English terms). */
export function transcriptionLanguages(code: string | undefined): string[] {
  if (!code) return [];
  return code === 'en' ? ['en'] : [code, 'en'];
}

/** A line for the transcriber's prompt that asks for the language's own script. */
export function scriptHint(code: string | undefined): string {
  const l = getLanguage(code);
  return l?.script ? `${l.name} speech, written in ${l.script} script; English words stay in English.` : '';
}

/** The instruction about which language to write notes in. `code` is a language, or 'spoken' for the recording's own. */
export function notesLanguageRule(code: string | undefined): string {
  const l = code && code !== 'spoken' ? getLanguage(code) : undefined;
  if (!l) {
    return 'Write in the language that was spoken. If languages were mixed, use the main one and keep technical terms as they were said.';
  }
  const named = l.native !== l.name ? `${l.name} (${l.native})` : l.name;
  return `Write in ${named}, whatever language was spoken. Keep names, product names and technical terms as they were said. This overrides any other instruction about the output language.`;
}
