import AirDatepicker, { type AirDatepickerOptions } from 'air-datepicker';
import localeEn from 'air-datepicker/locale/en';
import 'air-datepicker/air-datepicker.css';
import './calendar.css';

/**
 * A calendar of the app's, drawn inline in what holds it: custom-rendered, with no native <select>, so it behaves under WSLg, in the app's palette (calendar.css), and its weeks start on Monday (decided 2026-10-29).
 * The session list's date filter and Pick a date… are both one, so they look and behave alike.
 */
export function calendar(el: HTMLElement, options: AirDatepickerOptions<HTMLElement>): AirDatepicker<HTMLElement> {
  return new AirDatepicker(el, { inline: true, locale: localeEn, firstDay: 1, classes: 'calendar', ...options });
}
