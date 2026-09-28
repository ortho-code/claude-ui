import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: {} }));

import { describeInstall } from './diagnostics';

const facts = { packaged: true, appImage: undefined, execPath: '/opt/Claude UI/claude-ui-app', packageType: null };

describe('describeInstall', () => {
  it('says source for a copy run with npm start, whatever else is set', () => {
    expect(describeInstall({ ...facts, packaged: false, appImage: '/home/me/claude-ui.AppImage', packageType: 'deb' })).toBe('source');
  });

  it('names the AppImage file being run', () => {
    expect(describeInstall({ ...facts, appImage: '/home/me/claude-ui.AppImage', execPath: '/tmp/.mount_claude/claude-ui-app' })).toBe(
      'AppImage /home/me/claude-ui.AppImage',
    );
  });

  it('reports a packaged copy by where it runs from, adding package-type only when the build has one', () => {
    expect(describeInstall({ ...facts, packageType: 'deb' })).toBe('packaged /opt/Claude UI/claude-ui-app, package-type deb');
    expect(describeInstall(facts)).toBe('packaged /opt/Claude UI/claude-ui-app');
    expect(describeInstall({ ...facts, execPath: '/Volumes/Claude UI/Claude UI.app/Contents/MacOS/Claude UI' })).toBe(
      'packaged /Volumes/Claude UI/Claude UI.app/Contents/MacOS/Claude UI',
    );
  });
});
