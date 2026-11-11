import { describe, it, expect } from 'vitest';
import { changedSettings, fileChanges, fileEdits, sameValue, saveRefusal, settingProblem, settingsInForce, settingsView, type SettingsFileRead } from '../../../../src/shared/config/settings';
import { bundledNeedsYou } from '../../../renderer/support/needs-you';

const missing: SettingsFileRead = { name: 'settings.json', status: 'missing', error: null, json: null };
const holding = (json: unknown): SettingsFileRead => ({ name: 'settings.json', status: 'read', error: null, json });

describe('the settings in force', () => {
  it('are the defaults without the file', () => {
    const view = settingsView(missing);
    expect(view.launchFlags).toEqual({ value: '', problem: null });
    expect(view.notes).toEqual([]);
    // What was running when the app closed comes back marked as needing you until someone chooses otherwise.
    expect(settingsInForce(view)).toEqual({ launchFlags: '', runningSessionsAtLaunch: 'cold', prStatus: true, leaveButton: 'stop-close', setAside: ['tomorrow', 'in 1w', 'whenever'], setAsideTime: '09:00', locale: '', strength: ['waiting', 'busy', 'background', 'needs-you', 'ready', 'closed'], looks: {}, needsYou: {}, approvals: {} });
  });

  it("take the file's approvals by repository, none unless told otherwise, and none of an object with a mistake", () => {
    expect(settingsView(holding({ approvals: { 'acme/app': 2 } })).approvals).toEqual({ value: { 'acme/app': 2 }, problem: null });
    expect(settingsView(holding({ approvals: { 'acme/app': 2, acme: 1 } })).approvals).toEqual({ value: {}, problem: '"acme" is not a repository written as owner/name.' });
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
  const mine = ['waiting', 'back-to-work', 'busy', 'background', 'needs-you', 'ready', 'closed'];

  it("is the file's where it reads, checked against the categories where they are given", () => {
    expect(settingsView(holding({ strength: mine }), 0, bundledNeedsYou()).strength).toEqual({ value: mine, problem: null });
    expect(settingsView(holding({ strength: mine }), 0).strength).toEqual({ value: mine, problem: null });
  });

  it('keeps the default, the whole list unused, for a list with a mistake, saying why', () => {
    const wrong = ['waiting', 'back-to-wrok', ...mine.slice(2)];
    expect(settingsView(holding({ strength: wrong }), 0, bundledNeedsYou()).strength).toEqual({
      value: ['waiting', 'busy', 'background', 'needs-you', 'ready', 'closed'],
      problem: '"back-to-wrok" is neither a status, "needs-you" nor a needs-you category.',
    });
    expect(settingsView(holding({ strength: ['waiting'] })).strength.problem).toBe('It has to name "busy", "background", "ready", "closed", "needs-you" too: every status and "needs-you" once.');
  });
});

describe('the looks', () => {
  const mine = { 'finish-up': { colour: 'green' }, 'pr.merged': { mark: 'check' } };

  it("are the file's where they read, checked against the categories and types where they are given", () => {
    expect(settingsView(holding({ looks: mine }), 0, bundledNeedsYou()).looks).toEqual({ value: mine, problem: null });
    expect(settingsView(holding({ looks: { 'pr.merdged': { colour: 'green' } } }), 0).looks.problem).toBeNull();
  });

  it('keep the default, every look unused, for looks with a mistake, saying why', () => {
    expect(settingsView(holding({ looks: { ...mine, 'pr.merdged': { colour: 'green' } } }), 0, bundledNeedsYou()).looks).toEqual({
      value: {},
      problem: '"pr.merdged" is neither a status, "needs-you", a category nor a type.',
    });
    expect(settingsView(holding({ looks: { ready: { colour: 'orange' } } })).looks.problem).toBe(
      '"ready": "colour" has to be one of "rosewater", "flamingo", "pink", "mauve", "red", "maroon", "peach", "yellow", "green", "teal", "sky", "sapphire", "blue", "lavender", "muted", or "#rrggbb".',
    );
  });
});

describe('needsYou', () => {
  const bundled = bundledNeedsYou();
  const typeOf = (view: ReturnType<typeof settingsView>, id: string) => view.needsYouRegistry?.types.find((type) => type.id === id);

  it('is nothing changed without the file, the categories and types in force the ones the app ships', () => {
    const view = settingsView(missing, 0, bundled);
    expect(view.needsYou).toEqual({ value: {}, problem: null });
    expect(view.needsYouRegistry).toEqual(bundled);
  });

  it('switches off and changes what the app ships by id, the rest as it ships', () => {
    const view = settingsView(holding({ needsYou: { 'pr.merged': { enabled: false }, 'pr.approved': { roles: ['own', 'reviewing'] } } }), 0, bundled);
    expect(view.needsYou.problem).toBeNull();
    expect(typeOf(view, 'pr.merged')?.enabled).toBe(false);
    expect(typeOf(view, 'pr.approved')?.roles).toEqual(['own', 'reviewing']);
    expect(typeOf(view, 'pr.closed')).toEqual(bundled.types.find((type) => type.id === 'pr.closed'));
  });

  it('is not used at all for one entry with a mistake, every category and type as the app ships it, saying why', () => {
    const view = settingsView(holding({ needsYou: { 'pr.merged': { enabled: false }, 'pr.merge': { enabled: false } } }), 0, bundled);
    expect(view.needsYou).toEqual({ value: {}, problem: '"pr.merge": nothing the app ships has the id "pr.merge"' });
    expect(view.needsYouRegistry).toEqual(bundled);
    expect(settingsInForce(view).needsYou).toEqual({});
  });

  it('has to be an object of objects, checked so without what the app ships, as for a save', () => {
    expect(settingProblem('needsYou', { 'pr.merged': false })).toBe('It has to be an object of ids, each an object of the fields it changes, such as { "pr.merged": { "enabled": false } }.');
    expect(settingProblem('needsYou', { 'pr.nothing': { enabled: false } })).toBeNull();
    expect(settingsView(holding({ needsYou: { 'pr.nothing': { enabled: false } } })).needsYouRegistry).toBeNull();
  });

  it('is what the strength order and the looks are checked against: a category it moves or switches off is still one', () => {
    const view = settingsView(holding({ needsYou: { 'finish-up': { enabled: false } }, strength: ['waiting', 'finish-up', 'busy', 'background', 'needs-you', 'ready', 'closed'] }), 0, bundled);
    expect(view.strength.problem).toBeNull();
    expect(view.needsYouRegistry?.categories.find((category) => category.id === 'finish-up')?.enabled).toBe(false);
  });
});

describe('sameValue', () => {
  it('compares a list item by item and an object key by key, in any order, so a save of an object setting as it stands writes nothing', () => {
    expect(sameValue({ 'acme/app': 2, 'acme/web': 1 }, { 'acme/web': 1, 'acme/app': 2 })).toBe(true);
    expect(sameValue({ 'pr.merged': { enabled: false } }, { 'pr.merged': { enabled: true } })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue(['in 2h', 'whenever'], ['whenever', 'in 2h'])).toBe(false);
    const view = settingsView(holding({ approvals: { 'acme/app': 2 }, looks: { ready: { colour: 'teal' } } }));
    expect(fileChanges(view, { approvals: { 'acme/app': 2 }, looks: { ready: { colour: 'teal' } } })).toEqual([]);
    expect(fileChanges(view, { approvals: {} })).toEqual([{ key: 'approvals', value: {} }]);
  });
});

describe('changedSettings', () => {
  it('lists nothing without the file, nor for a file the starter wrote with every default', () => {
    expect(changedSettings(settingsView(missing))).toEqual([]);
    expect(changedSettings(settingsView(holding({ launchFlags: '', setAside: ['tomorrow', 'in 1w', 'whenever'], looks: {}, approvals: {} })))).toEqual([]);
  });

  it('lists each setting that differs from the default with that default, a value read as the default not among them', () => {
    expect(changedSettings(settingsView(holding({ locale: 'nl-NL', leaveButton: 'none', runningSessionsAtLaunch: 'pause', approvals: { 'acme/app': 2 } })))).toEqual([
      { key: 'leaveButton', id: null, value: 'none', fallback: 'stop-close', problem: null },
      { key: 'locale', id: null, value: 'nl-NL', fallback: '', problem: null },
      { key: 'approvals', id: null, value: { 'acme/app': 2 }, fallback: {}, problem: null },
    ]);
  });

  it('lists a value the file gives that is not used, with why, the default in force', () => {
    expect(changedSettings(settingsView(holding({ leaveButton: 'sideways' })))).toEqual([{ key: 'leaveButton', id: null, value: 'stop-close', fallback: 'stop-close', problem: 'It has to be one of "stop-close", "stop-finish", "close", "finish", "none".' }]);
  });

  it('lists needsYou once per id it changes', () => {
    expect(changedSettings(settingsView(holding({ needsYou: { 'pr.merged': { enabled: false }, 'pr.approved': { roles: ['own', 'reviewing'] } } }), 0, bundledNeedsYou()))).toEqual([
      { key: 'needsYou', id: 'pr.merged', value: { enabled: false }, fallback: null, problem: null },
      { key: 'needsYou', id: 'pr.approved', value: { roles: ['own', 'reviewing'] }, fallback: null, problem: null },
    ]);
  });

  it('leaves out an id needsYou names to no effect, and an entry Reset emptied', () => {
    const view = settingsView(holding({ needsYou: { 'pr.merged': {}, 'pr.closed': { enabled: true }, 'pr.approved': { roles: ['own'], label: 'Approved' } } }), 0, bundledNeedsYou());
    expect(view.needsYouChanges).toEqual({ 'pr.approved': ['label'] });
    expect(changedSettings(view).map((row) => row.id)).toEqual(['pr.approved']);
  });
});

describe('fileEdits', () => {
  it('edits an object setting entry by entry, so the entries left alone keep their text, and any other setting whole', () => {
    const view = settingsView(holding({ needsYou: { 'pr.merged': { enabled: false }, 'pr.closed': { enabled: false } }, locale: 'nl-NL' }), 0, bundledNeedsYou());
    expect(fileEdits(view, { needsYou: { 'pr.merged': {}, 'pr.closed': { enabled: false } }, locale: 'en-GB' })).toEqual([
      { path: ['locale'], value: 'en-GB' },
      { path: ['needsYou', 'pr.merged'], value: {} },
    ]);
  });

  it('writes a setting whole when the file’s value is not used, since there are no entries of it to keep', () => {
    const view = settingsView(holding({ approvals: { acme: 2 } }));
    expect(fileEdits(view, { approvals: {} })).toEqual([{ path: ['approvals'], value: {} }]);
  });
});
