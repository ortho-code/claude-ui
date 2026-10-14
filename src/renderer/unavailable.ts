import { setTooltip } from './tooltip';

/**
 * Mark a control unavailable, carrying the reason, or available again when `reason` is null.
 *
 * `aria-disabled` rather than the `disabled` PROPERTY, so that the reason reaches the keyboard as well as the pointer: a natively disabled button takes no focus, and the tooltip, which shows on `:focus-visible` as well as on hover, is then the pointer's alone.
 * The click is refused by the handler instead, which `unavailable()` answers for.
 */
export function setUnavailable(control: HTMLElement, reason: string | null, tooltipWhenAvailable?: string): void {
  control.classList.toggle('unavailable', reason !== null);
  if (reason) control.setAttribute('aria-disabled', 'true');
  else control.removeAttribute('aria-disabled');
  setTooltip(control, reason ?? tooltipWhenAvailable ?? null);
}

/** Whether a control has been marked unavailable, for the handlers that must then do nothing. */
export function unavailable(control: HTMLElement): boolean {
  return control.getAttribute('aria-disabled') === 'true';
}
