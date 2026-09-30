import { setTooltip } from './tooltip';

/**
 * Mark a control unavailable, carrying the reason, or available again when `reason` is null.
 *
 * `aria-disabled` rather than the `disabled` PROPERTY, and that is the whole point: a natively disabled button emits no mouse events in Chromium, so the tooltip delegated from `document` never fires and the one thing that says WHY is invisible.
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
