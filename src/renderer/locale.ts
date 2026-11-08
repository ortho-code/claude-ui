import { store } from './state/app';

/**
 * THE LANGUAGE THE APP FORMATS TIMES AND DATES IN: the language setting's (`Settings.locale`), or the window's own while the setting says the system's.
 * Named wherever the app formats a moment or lays out a calendar, rather than left to the window's default, which is the language its renderer started in and does not follow a change of the setting (docs/architecture/window.md § The language).
 * The app's own words stay English whatever it is.
 */

/** `Intl.Locale` with its week, which the renderer's lib (ES2022) does not type yet; Chromium has it. */
type LocaleWithWeek = Intl.Locale & { getWeekInfo(): { firstDay: number } };

/** The language the setting `setting` names, or `system`, the window's own, for `""`. */
export function languageOf(setting: string, system: string): string {
  return setting === '' ? system : setting;
}

/** The language in force now, from the store's settings; the window's own before they are read. */
export function language(): string {
  return languageOf(store.get().settings?.locale.value ?? '', navigator.language);
}

/** The day `tag` starts its weeks on, counted as the calendars count, 0 for Sunday to 6 for Saturday. */
export function firstWeekday(tag: string): number {
  return (new Intl.Locale(tag) as LocaleWithWeek).getWeekInfo().firstDay % 7;
}

/** Call `fn` whenever the language in force changes, which a change of the setting makes it do; answers the unsubscribe. */
export function onLanguageChange(fn: () => void): () => void {
  return store.watch(['settings'], ({ settings }, before) => {
    if ((settings?.locale.value ?? '') !== (before.settings?.locale.value ?? '')) fn();
  });
}
