import { describe, it, expect } from 'vitest';
import { fileChanges, saveRefusal, settingProblem, settingsInForce, settingsView, type SettingsFileRead } from '../../../src/shared/settings';

const missing: SettingsFileRead = { name: 'settings.json', status: 'missing', error: null, json: null };
const holding = (json: unknown): SettingsFileRead => ({ name: 'settings.json', status: 'read', error: null, json });

describe('the settings in force', () => {
  it('are the defaults without the file', () => {
    const view = settingsView(missing);
    expect(view.launchFlags).toEqual({ value: '', problem: null });
    expect(view.notes).toEqual([]);
    // What was running when the app closed comes back paused until someone chooses otherwise.
    expect(settingsInForce(view)).toEqual({ launchFlags: '', runningSessionsAtLaunch: 'pause', prStatus: true });
  });

  it('take a choice of the file for the sessions running at quit, and leave out one that is no choice', () => {
    expect(settingsView(holding({ runningSessionsAtLaunch: 'start' })).runningSessionsAtLaunch).toEqual({ value: 'start', problem: null });
    for (const wrong of ['resume', true, 1, null]) {
      const view = settingsView(holding({ runningSessionsAtLaunch: wrong }));
      expect(view.runningSessionsAtLaunch).toEqual({ value: 'pause', problem: 'It has to be one of "start", "pause", "leave".' });
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
    expect(fileChanges(settingsView(holding({ launchFlags: '--mine' })), { launchFlags: '--mine', runningSessionsAtLaunch: 'pause', prStatus: true })).toEqual([]);
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
