import AirDatepicker, { type AirDatepickerOptions } from 'air-datepicker';
import localeEn from 'air-datepicker/locale/en';
import 'air-datepicker/air-datepicker.css';
import { firstWeekday, language, onLanguageChange } from './locale';
import './calendar.css';

/**
 * A calendar of the app's, drawn inline in what holds it: custom-rendered, with no native <select>, so it behaves under WSLg, in the app's palette (calendar.css), and its weeks start on the day the language setting's start (decided 2026-10-29), an open one following a change of it.
 * Its words stay English, as the app's do.
 * The session list's date filter and Pick a date… are both one, so they look and behave alike.
 */
export function calendar(el: HTMLElement, options: AirDatepickerOptions<HTMLElement>): AirDatepicker<HTMLElement> {
  const picker = new AirDatepicker(el, { inline: true, locale: localeEn, firstDay: firstWeekday(language()), classes: 'calendar', ...options });
  onLanguageChange(() => picker.update({ firstDay: firstWeekday(language()) }));
  return picker;
}
