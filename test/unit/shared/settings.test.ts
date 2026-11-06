import { describe, it, expect } from 'vitest';
import { fileChanges, saveRefusal, settingProblem, settingsInForce, settingsView, type SettingsFileRead } from '../../../src/shared/settings';
import { bundledNeedsYou } from '../../renderer/support/needsyou';

const missing: SettingsFileRead = { name: 'settings.json', status: 'missing', error: null, json: null };
const holding = (json: unknown): SettingsFileRead => ({ name: 'settings.json', status: 'read', error: null, json });

describe('the settings in force', () => {
  it('are the defaults without the file', () => {
    const view = settingsView(missing);
    expect(view.launchFlags).toEqual({ value: '', problem: null });
    expect(view.notes).toEqual([]);
    // What was running when the app closed comes back marked as needing you until someone chooses otherwise.
    expect(settingsInForce(view)).toEqual({ launchFlags: '', runningSessionsAtLaunch: 'cold', prStatus: true, leaveButton: 'stop-close', setAside: ['tomorrow', 'in 1w', 'whenever'], setAsideTime: '09:00', locale: '', strength: ['waiting', 'busy', 'background', 'needs-you', 'idle', 'closed'] });
  });

  it("take a language of the file in its usual case, the system's unless told otherwise, and leave out one that is no language tag", () => {
    expect(settingsView(holding({ locale: 'en-GB' })).locale).toEqual({ value: 'en-GB', problem: null });
    expect(settingsView(holding({ locale: 'nl-nl' })).locale).toEqual({ value: 'nl-NL', problem: null });
    expect(settingsView(holding({ locale: '' })).locale).toEqual({ value: '', problem: null });
    // `C` is what this machine's `LANG` holds, and `en_GB` how a `LANG` spells a language.
    for (const wrong of ['C', 'en_GB', 'en-GB, nl-NL', ' en-GB', 'x', 31, null]) {
      expect(settingsView(holding({ locale: wrong })).locale).toEqual({ value: '', problem: 'It has to be a language tag such as "en-GB" or "nl-NL", or "" for the system\'s language.' });
    }
  });

  it('take a time of day of the file for a set-aside choice without one, 09:00 unless told otherwise, and leave out one that is no time in 24 hours', () => {
    expect(settingsView(holding({ setAsideTime: '17:30' })).setAsideTime).toEqual({ value: '17:30', problem: null });
    for (const wrong of ['9:00', '24:00', '09:60', '9am', 900, null]) {
      expect(settingsView(holding({ setAsideTime: wrong })).setAsideTime).toEqual({ value: '09:00', problem: 'It has to be a time of day as "HH:MM", in 24 hours, such as "09:00".' });
    }
  });

  it("take the file's set-aside choices, today's three unless told otherwise, and none of a list with one that does not read", () => {
    expect(settingsView(missing).setAside).toEqual({ value: ['tomorrow', 'in 1w', 'whenever'], problem: null });
    expect(settingsView(holding({ setAside: ['in 2h', 'next monday 09:00'] })).setAside).toEqual({ value: ['in 2h', 'next monday 09:00'], problem: null });
    expect(settingsView(holding({ setAside: [] })).setAside).toEqual({ value: [], problem: null });
    expect(settingsView(holding({ setAside: ['in 2h', 'nxt monday'] })).setAside).toEqual({
      value: ['tomorrow', 'in 1w', 'whenever'],
      problem: '"nxt monday" is not a choice the app reads: write "whenever", "in 30m", "in 2h", "in 3d 14:00", "in 1w", "tomorrow 09:00" or "next monday 09:00", a time only where a day is.',
    });
    expect(settingsView(holding({ setAside: 'tomorrow' })).setAside.problem).toBe('It has to be a list of choices, such as ["tomorrow", "in 1w", "whenever"].');
  });

  it('take laterTime, the name the time of day had before it was released, as no setting', () => {
    expect(settingsView(holding({ laterTime: '17:30' })).notes).toEqual(['settings.json: "laterTime" is not a setting the app has.']);
  });

  it('write a list of choices only when it differs from the one in force, item by item', () => {
    const view = settingsView(holding({ setAside: ['in 2h', 'whenever'] }));
    expect(fileChanges(view, { setAside: ['in 2h', 'whenever'] })).toEqual([]);
    expect(fileChanges(view, { setAside: ['whenever', 'in 2h'] })).toEqual([{ key: 'setAside', value: ['whenever', 'in 2h'] }]);
    expect(fileChanges(settingsView(missing), { setAside: ['tomorrow', 'in 1w', 'whenever'] })).toEqual([]);
  });

  it("take a choice of the file for a tab's button, stop then close unless told otherwise, and leave out one that is no choice", () => {
    expect(settingsView(missing).leaveButton.value).toBe('stop-close');
    for (const choice of ['stop-close', 'stop-finish', 'close', 'finish', 'none']) {
      expect(settingsView(holding({ leaveButton: choice })).leaveButton).toEqual({ value: choice, problem: null });
    }
    // The values before the act was called Finished are not read: nothing released had them (decided 2026-11-05).
    for (const wrong of ['stop', 'close-finish', 'stop-archive', 'archive', true, null]) {
      expect(settingsView(holding({ leaveButton: wrong })).leaveButton).toEqual({ value: 'stop-close', problem: 'It has to be one of "stop-close", "stop-finish", "close", "finish", "none".' });
    }
  });

  it('take a choice of the file for the sessions running at quit, and leave out one that is no choice', () => {
    expect(settingsView(holding({ runningSessionsAtLaunch: 'start' })).runningSessionsAtLaunch).toEqual({ value: 'start', problem: null });
    for (const wrong of ['resume', true, 1, null]) {
      const view = settingsView(holding({ runningSessionsAtLaunch: wrong }));
      expect(view.runningSessionsAtLaunch).toEqual({ value: 'cold', problem: 'It has to be one of "start", "cold".' });
    }
  });

  // The choices from while the setting also said whether they were marked, which a file written then holds; marking is the type's now (decided 2026-11-06).
  it('read "mark", "pause" and "leave" for the sessions running at quit as "cold", and leave the file as it is on a save that keeps it', () => {
    for (const older of ['mark', 'pause', 'leave']) {
      const view = settingsView(holding({ runningSessionsAtLaunch: older }));
      expect(view.runningSessionsAtLaunch).toEqual({ value: 'cold', problem: null });
      expect(fileChanges(view, { runningSessionsAtLaunch: 'cold' })).toEqual([]);
    }
  });

  it('ask GitHub for PR status unless the file says not to, and leave out a value that is not true or false', () => {
    expect(settingsView(missing).prStatus.value).toBe(true);
    expect(settingsView(holding({ prStatus: false })).prStatus.value).toBe(false);
    for (const wrong of ['false', 0, null]) {
      expect(settingsView(holding({ prStatus: wrong })).prStatus).toEqual({ value: true, problem: 'It has to be true or false.' });
    }
  });

  it('name the setting it replaced as one the app does not have, rather than reading it', () => {
    expect(settingsView(holding({ resumeRunningSessionsOnStartup: false })).notes).toEqual(['settings.json: "resumeRunningSessionsOnStartup" is not a setting the app has.']);
  });

  it('take the file’s value over the default', () => {
    expect(settingsView(holding({ launchFlags: '--mine' })).launchFlags).toEqual({ value: '--mine', problem: null });
  });

  it('leave out a value the file gives that the setting may not hold, and say why', () => {
    const view = settingsView(holding({ launchFlags: '--session-id x' }));
    expect(view.launchFlags).toEqual({ value: '', problem: "--session-id can't be set here — claude-ui gives each session its own id, and claude refuses an id twice." });
    expect(settingsView(holding({ launchFlags: 42 })).launchFlags.problem).toBe('It has to be text: the flags as you would type them.');
  });

  it('name a key that is no setting once, as no setting, however often the file names it', () => {
    const view = settingsView({ ...holding({ foo: 2 }), duplicates: ['foo'] });
    expect(view.notes).toEqual(['settings.json: "foo" is not a setting the app has.']);
  });

  it('name a setting the file names more than once as a note, the last one read', () => {
    const view = settingsView({ ...holding({ prStatus: false }), duplicates: ['prStatus'] });
    expect(view.prStatus.value).toBe(false);
    expect(view.notes).toEqual(['settings.json names "prStatus" more than once: the last is the one read, and Settings refuses a save that would change it until only one is left.']);
    expect(view.file.duplicates).toEqual(['prStatus']);
  });

  it('name a setting the app does not have, and a file that holds no object, as notes', () => {
    expect(settingsView(holding({ lanchFlags: '--x' })).notes).toEqual(['settings.json: "lanchFlags" is not a setting the app has.']);
    expect(settingsView(holding([1, 2])).notes).toEqual(['settings.json has to hold one object, { … }, so none of it is used.']);
    expect(settingsView(holding(null)).notes).toEqual(['settings.json has to hold one object, { … }, so none of it is used.']);
  });

  it('keep the last good read of a file that does not parse in force, and say so', () => {
    const broken: SettingsFileRead = { name: 'settings.json', status: 'unparsable', error: 'expected a comma at line 3, column 3', json: { launchFlags: '--before' } };
    const view = settingsView(broken);
    expect(view.launchFlags.value).toBe('--before');
    expect(view.notes).toEqual(['settings.json does not parse: expected a comma at line 3, column 3. The settings it last read stay in force.']);
    expect(view.file).toEqual({ name: 'settings.json', status: 'unparsable', error: 'expected a comma at line 3, column 3', duplicates: [] });
  });

  it('use none of a file that has never parsed', () => {
    const broken: SettingsFileRead = { name: 'settings.json', status: 'unparsable', error: 'expected a value at the end of the file', json: null };
    expect(settingsView(broken).notes).toEqual(['settings.json does not parse: expected a value at the end of the file. None of its settings are used until it does.']);
  });

  it('carry the number of the read that made them, 0 for one made otherwise', () => {
    expect(settingsView(missing).read).toBe(0);
    expect(settingsView(missing, 7).read).toBe(7);
  });
});

describe('what a save writes into the file', () => {
  it('writes a value that differs from the one in force', () => {
    expect(fileChanges(settingsView(holding({ launchFlags: '--mine' })), { launchFlags: '--other' })).toEqual([{ key: 'launchFlags', value: '--other' }]);
    expect(fileChanges(settingsView(missing), { prStatus: false })).toEqual([{ key: 'prStatus', value: false }]);
  });

  it('writes the default over another value the file holds, so the line stays', () => {
    expect(fileChanges(settingsView(holding({ prStatus: false })), { prStatus: true })).toEqual([{ key: 'prStatus', value: true }]);
  });

  it('writes nothing for a value already in force, from the file or the default, so no key only repeats the default', () => {
    expect(fileChanges(settingsView(holding({ launchFlags: '--mine' })), { launchFlags: '--mine', runningSessionsAtLaunch: 'cold', prStatus: true })).toEqual([]);
    expect(fileChanges(settingsView(missing), {})).toEqual([]);
  });

  it('writes over a value the file gives that is not used, even with the default, so the file holds one that is', () => {
    expect(fileChanges(settingsView(holding({ launchFlags: '--session-id x' })), { launchFlags: '' })).toEqual([{ key: 'launchFlags', value: '' }]);
  });

  it('is refused when it would write a setting the file names more than once, and not for one it leaves as it is', () => {
    const view = settingsView({ ...holding({ prStatus: false, launchFlags: '--mine' }), duplicates: ['prStatus', 'launchFlags'] });
    expect(saveRefusal(view, { prStatus: true, launchFlags: '--other' })).toBe('settings.json names "launchFlags" and "prStatus" more than once, so nothing was saved: leave one of each, then save again.');
    expect(saveRefusal(view, { prStatus: false, launchFlags: '--mine', runningSessionsAtLaunch: 'start' })).toBeNull();
  });

  it('is refused for a value the setting may not hold', () => {
    expect(settingProblem('launchFlags', '--allowedTools Grep')).toBeNull();
    expect(settingProblem('launchFlags', '--resume x')).toBe("--resume can't be set here — claude-ui decides which session a tab resumes.");
    expect(settingProblem('launchFlags', 7)).toBe('It has to be text: the flags as you would type them.');
  });
});

describe('the strength order', () => {
  const mine = ['waiting', 'back-to-work', 'busy', 'background', 'needs-you', 'idle', 'closed'];

  it("is the file's where it reads, checked against the categories where they are given", () => {
    expect(settingsView(holding({ strength: mine }), 0, bundledNeedsYou()).strength).toEqual({ value: mine, problem: null });
    expect(settingsView(holding({ strength: mine }), 0).strength).toEqual({ value: mine, problem: null });
  });

  it('keeps the default, the whole list unused, for a list with a mistake, saying why', () => {
    const wrong = ['waiting', 'back-to-wrok', ...mine.slice(2)];
    expect(settingsView(holding({ strength: wrong }), 0, bundledNeedsYou()).strength).toEqual({
      value: ['waiting', 'busy', 'background', 'needs-you', 'idle', 'closed'],
      problem: '"back-to-wrok" is neither a status, "needs-you" nor a needs-you category.',
    });
    expect(settingsView(holding({ strength: ['waiting'] })).strength.problem).toBe('It has to name "busy", "background", "idle", "closed", "needs-you" too: every status and "needs-you" once.');
  });
});
