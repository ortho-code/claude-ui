import { describe, it, expect } from 'vitest';
import { clockLines, clockOf, clockText, scheduledLines } from '../../../../src/renderer/status/clock';

describe('scheduledLines', () => {
  const cron = { prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' };
  const wakeup = { prompt: '/loop check the deploy', recurring: false, cron: null };

  it("names each task on a line of its own, a cron with its schedule in claude's words, each with what a stop does to it, and says nothing for none", () => {
    expect(scheduledLines([])).toBe(null);
    expect(scheduledLines([wakeup, cron])).toEqual(['Scheduled:', '/loop check the deploy · ends with the session', 'say the word tock · Every 10 minutes · comes back when you open the session']);
  });

  it('names what a tab kept from when its claude went under a heading of its own', () => {
    expect(scheduledLines([cron], 'Scheduled when stopped:')).toEqual(['Scheduled when stopped:', 'say the word tock · Every 10 minutes · comes back when you open the session']);
  });
});

describe('clockOf', () => {
  const tock = [{ prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' }];
  const tick = [{ prompt: 'say tock again', recurring: false, cron: 'Runs once in 1h' }];

  it("shows what the session's claude last reported, over anything its tab kept", () => {
    expect(clockOf(tock, { scheduledWhenStopped: tick })).toEqual({ tasks: tock, stopped: false });
    expect(clockOf(tock, undefined)).toEqual({ tasks: tock, stopped: false });
  });

  it('shows what its tab kept from when its claude went, muted, while nothing is reported', () => {
    expect(clockOf(undefined, { scheduledWhenStopped: tick })).toEqual({ tasks: tick, stopped: true });
    expect(clockOf([], { scheduledWhenStopped: tick })).toEqual({ tasks: tick, stopped: true });
  });

  it('shows nothing for neither', () => {
    expect(clockOf(undefined, { scheduledWhenStopped: null })).toBe(null);
    expect(clockOf(undefined, undefined)).toBe(null);
  });
});

describe('clockText', () => {
  const tock = [{ prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' }];

  it('says the tasks under the heading for live ones, or for the ones a stopped tab kept', () => {
    expect(clockText({ tasks: tock, stopped: false })).toBe('Scheduled:\nsay the word tock · Every 10 minutes · comes back when you open the session');
    expect(clockText({ tasks: tock, stopped: true })).toBe('Scheduled when stopped:\nsay the word tock · Every 10 minutes · comes back when you open the session');
    expect(clockLines({ tasks: tock, stopped: true })).toEqual(['Scheduled when stopped:', 'say the word tock · Every 10 minutes · comes back when you open the session']);
  });

  it('says nothing for no clock', () => {
    expect(clockText(null)).toBe(null);
    expect(clockLines(null)).toBe(null);
  });
});
