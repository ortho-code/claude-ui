import { describe, it, expect } from 'vitest';
import { appFileChanges, settingProblem, settingsInForce, settingsView, type SettingsFileRead } from '../../../src/shared/settings';

const missing = (name: string): SettingsFileRead => ({ name, status: 'missing', error: null, json: null });
const holding = (name: string, json: unknown): SettingsFileRead => ({ name, status: 'read', error: null, json });
const yours = (json: unknown): SettingsFileRead => holding('settings.json', json);
const apps = (json: unknown): SettingsFileRead => holding('settings.local.json', json);
const noYours = missing('settings.json');
const noApps = missing('settings.local.json');

describe('the settings in force', () => {
  it('are the defaults without either file', () => {
    const view = settingsView(noYours, noApps);
    expect(view.launchFlags).toEqual({ value: '', source: 'default', without: '', withoutSource: 'default', problems: [] });
    expect(view.notes).toEqual([]);
    expect(settingsInForce(view)).toEqual({ launchFlags: '' });
  });

  it('take yours over the default, and the app’s over yours', () => {
    expect(settingsView(yours({ launchFlags: '--mine' }), noApps).launchFlags).toMatchObject({ value: '--mine', source: 'yours', without: '--mine', withoutSource: 'yours' });
    expect(settingsView(yours({ launchFlags: '--mine' }), apps({ launchFlags: '--app' })).launchFlags).toMatchObject({ value: '--app', source: 'app', without: '--mine', withoutSource: 'yours' });
    expect(settingsView(noYours, apps({ launchFlags: '--app' })).launchFlags).toMatchObject({ value: '--app', source: 'app', without: '', withoutSource: 'default' });
  });

  it('leave out a value a file gives that the setting may not hold, and say why beside the file’s name', () => {
    const view = settingsView(yours({ launchFlags: '--session-id x' }), apps({ launchFlags: 42 }));
    expect(view.launchFlags.value).toBe('');
    expect(view.launchFlags.problems).toEqual([
      { file: 'settings.json', why: "--session-id can't be set here — claude-ui gives each session its own id, and claude refuses an id twice." },
      { file: 'settings.local.json', why: 'It has to be text: the flags as you would type them.' },
    ]);
  });

  it('name a setting the app does not have, and a file that holds no object, as notes', () => {
    expect(settingsView(yours({ lanchFlags: '--x' }), noApps).notes).toEqual(['settings.json: "lanchFlags" is not a setting the app has.']);
    expect(settingsView(yours([1, 2]), noApps).notes).toEqual(['settings.json has to hold one object, { … }, so none of it is used.']);
    expect(settingsView(yours(null), noApps).notes).toEqual(['settings.json has to hold one object, { … }, so none of it is used.']);
  });

  it('keep the last good read of a file that does not parse in force, and say so', () => {
    const broken: SettingsFileRead = { name: 'settings.json', status: 'unparsable', error: 'expected a comma at line 3, column 3', json: { launchFlags: '--before' } };
    const view = settingsView(broken, noApps);
    expect(view.launchFlags.value).toBe('--before');
    expect(view.notes).toEqual(['settings.json does not parse: expected a comma at line 3, column 3. The settings it last read stay in force.']);
    expect(view.files.yours).toEqual({ name: 'settings.json', status: 'unparsable', error: 'expected a comma at line 3, column 3' });
  });

  it('use none of a file that has never parsed', () => {
    const broken: SettingsFileRead = { name: 'settings.json', status: 'unparsable', error: 'expected a value at the end of the file', json: null };
    expect(settingsView(broken, noApps).notes).toEqual(['settings.json does not parse: expected a value at the end of the file. None of its settings are used until it does.']);
  });
});

describe('what a save writes into the app’s file', () => {
  it('sets a value that differs from what would be in force without it', () => {
    expect(appFileChanges(settingsView(yours({ launchFlags: '--mine' }), noApps), { launchFlags: '--other' })).toEqual([{ key: 'launchFlags', value: '--other' }]);
  });

  it('removes the app’s value instead of copying yours, or the default where yours says nothing', () => {
    expect(appFileChanges(settingsView(yours({ launchFlags: '--mine' }), apps({ launchFlags: '--app' })), { launchFlags: '--mine' })).toEqual([{ key: 'launchFlags', value: undefined }]);
    expect(appFileChanges(settingsView(noYours, apps({ launchFlags: '--app' })), { launchFlags: '' })).toEqual([{ key: 'launchFlags', value: undefined }]);
  });

  it('removes it when asked outright, and touches nothing it was not asked about', () => {
    expect(appFileChanges(settingsView(noYours, apps({ launchFlags: '--app' })), { launchFlags: null })).toEqual([{ key: 'launchFlags', value: undefined }]);
    expect(appFileChanges(settingsView(noYours, noApps), {})).toEqual([]);
  });

  it('is refused for a value the setting may not hold', () => {
    expect(settingProblem('launchFlags', '--allowedTools Grep')).toBeNull();
    expect(settingProblem('launchFlags', '--resume x')).toBe("--resume can't be set here — claude-ui decides which session a tab resumes.");
    expect(settingProblem('launchFlags', 7)).toBe('It has to be text: the flags as you would type them.');
  });
});
