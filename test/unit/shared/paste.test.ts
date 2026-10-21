import { describe, it, expect } from 'vitest';
import { pastedPaths } from '../../../src/shared/paste';

describe('pastedPaths', () => {
  it('leaves a plain path as it is', () => {
    expect(pastedPaths(['/mnt/c/Users/me/shot.png'])).toBe('/mnt/c/Users/me/shot.png');
  });

  it('puts a backslash before each space and shell-special character', () => {
    expect(pastedPaths(['/mnt/c/My Pics/shot (1).png'])).toBe('/mnt/c/My\\ Pics/shot\\ \\(1\\).png');
    expect(pastedPaths(["/mnt/c/it's $HOME & [a]{b};c|d<e>f!g#h*i?j~k`l\"m^n"])).toBe("/mnt/c/it\\'s\\ \\$HOME\\ \\&\\ \\[a\\]\\{b\\}\\;c\\|d\\<e\\>f\\!g\\#h\\*i\\?j\\~k\\`l\\\"m\\^n");
    expect(pastedPaths(['/mnt/c/back\\slash'])).toBe('/mnt/c/back\\\\slash');
  });

  it('leaves letters outside ASCII, dots, dashes and commas alone', () => {
    expect(pastedPaths(['/mnt/c/Café/naïve-file,v2.png'])).toBe('/mnt/c/Café/naïve-file,v2.png');
  });

  it('joins several paths with a space, and none with nothing', () => {
    expect(pastedPaths(['/mnt/c/a.png', '/mnt/c/b c.png'])).toBe('/mnt/c/a.png /mnt/c/b\\ c.png');
    expect(pastedPaths([])).toBe('');
  });
});
