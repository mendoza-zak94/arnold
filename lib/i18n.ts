/**
 * i18n.ts - the fixed strings Arnold writes itself.
 *
 * Only the deterministic parts live here: receipts, totals, error messages. The
 * sentences a model writes are in the model's language already, because the
 * prompt says so - translating those here would just be a second, worse copy.
 *
 * Adding a language means adding one object below. Anything missing falls back
 * to English rather than showing a raw key, so a half finished translation is
 * usable instead of broken. See docs/CUSTOMIZE.md.
 */

export interface Strings {
  logged: string;
  today: string;
  intake: string;
  burned: string;
  deficit: string;
  surplus: string;
  target: string;
  remaining: string;
  over: string;
  protein: string;
  weight: string;
  trend: string;
  perWeek: string;
  measured: string;
  ofDays: string;
  noWeightYet: string;
  noTrendYet: string;
  workout: string;
  net: string;
  gross: string;
  deleted: string;
  updated: string;
  noted: string;
  templateSaved: string;
  settingsSaved: string;
  photoSaved: string;
  nothingLogged: string;
  notUnderstood: string;
  errorSaving: string;
  voiceUnavailable: string;
  notAllowed: string;
  chatIdIs: string;
  weeklyReport: string;
  habitOverLimit: string;
  sleepLogged: string;
}

const en: Strings = {
  logged: 'Logged',
  today: 'Today',
  intake: 'in',
  burned: 'out',
  deficit: 'deficit',
  surplus: 'surplus',
  target: 'target',
  remaining: 'left',
  over: 'over',
  protein: 'protein',
  weight: 'Weight',
  trend: 'Trend',
  perWeek: 'per week',
  measured: 'weighed on',
  ofDays: 'of the last 7 days',
  noWeightYet: 'No weight on file yet, so no energy balance. Step on a scale and tell me the number.',
  noTrendYet: 'Not enough weigh-ins for a trend yet.',
  workout: 'Training',
  net: 'net',
  gross: 'gross',
  deleted: 'Deleted',
  updated: 'Updated',
  noted: 'Noted',
  templateSaved: 'Template saved',
  settingsSaved: 'Saved',
  photoSaved: 'Photo stored',
  nothingLogged: 'Nothing logged - I did not find anything to record in that.',
  notUnderstood: 'I could not make sense of that. Nothing was saved. Try again with a bit more detail.',
  errorSaving: 'Something went wrong while saving. Your message is stored in the error log, so it is not lost.',
  voiceUnavailable: 'I cannot hear voice messages yet. Set STT_PROVIDER (openai or groq) plus the matching '
    + 'API key in your environment variables, or just send it as text.',
  notAllowed: 'This bot is private and your chat is not on the allow list.',
  chatIdIs: 'Your chat ID is',
  weeklyReport: 'Weekly report',
  habitOverLimit: 'over your daily limit',
  sleepLogged: 'Sleep',
};

const de: Strings = {
  logged: 'Notiert',
  today: 'Heute',
  intake: 'rein',
  burned: 'raus',
  deficit: 'Defizit',
  surplus: 'Ueberschuss',
  target: 'Ziel',
  remaining: 'offen',
  over: 'drueber',
  protein: 'Protein',
  weight: 'Gewicht',
  trend: 'Trend',
  perWeek: 'pro Woche',
  measured: 'gewogen am',
  ofDays: 'der letzten 7 Tage',
  noWeightYet: 'Noch kein Gewicht hinterlegt, deshalb keine Bilanz. Stell dich auf die Waage und sag mir die Zahl.',
  noTrendYet: 'Noch zu wenige Wiegungen fuer einen Trend.',
  workout: 'Training',
  net: 'netto',
  gross: 'brutto',
  deleted: 'Geloescht',
  updated: 'Geaendert',
  noted: 'Gemerkt',
  templateSaved: 'Vorlage gespeichert',
  settingsSaved: 'Gespeichert',
  photoSaved: 'Foto abgelegt',
  nothingLogged: 'Nichts verbucht - ich habe darin nichts zum Erfassen gefunden.',
  notUnderstood: 'Damit konnte ich nichts anfangen. Es wurde nichts gespeichert. Schick es gern nochmal, etwas ausfuehrlicher.',
  errorSaving: 'Beim Speichern ist etwas schiefgegangen. Deine Nachricht liegt im Fehler-Log, sie ist also nicht verloren.',
  voiceUnavailable: 'Sprachnachrichten kann ich noch nicht hoeren. Setz STT_PROVIDER (openai oder groq) plus '
    + 'den passenden API-Key in den Umgebungsvariablen, oder schick es als Text.',
  notAllowed: 'Dieser Bot ist privat und dein Chat steht nicht auf der Freigabeliste.',
  chatIdIs: 'Deine Chat-ID ist',
  weeklyReport: 'Wochenbericht',
  habitOverLimit: 'ueber deinem Tageslimit',
  sleepLogged: 'Schlaf',
};

const TABLES: Record<string, Strings> = {
  en, english: en,
  de, deutsch: de, german: de,
};

export function strings(language: string): Strings {
  return TABLES[language.toLowerCase().trim()] ?? en;
}

/** Number formatting that follows the language, not the server's locale. */
export function fmt(value: number | null | undefined, digits = 0, language = 'en'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '?';
  const locale = language.toLowerCase().startsWith('de') ? 'de-DE' : 'en-US';
  return value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
