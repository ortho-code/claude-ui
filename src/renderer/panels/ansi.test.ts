import { describe, it, expect } from 'vitest';
import { stripAnsi, splitPendingEscape } from './ansi';

// Captured from the real tools with colour forced, so the shapes here are what a panel will actually meet.
const GIT_STATUS = ' \x1b[31mM\x1b[m tracked\n\x1b[31m??\x1b[m untracked\n';
const GIT_LOG = '\x1b[33m92973a1\x1b[m init\n';
const GIT_DIFF = '\x1b[1mdiff --git a/tracked b/tracked\x1b[m\n\x1b[36m@@ -1 +1,2 @@\x1b[m\n a\x1b[m\n';
const LS = '\x1b[0m\x1b[01;34mdir\x1b[0m\n\x1b[01;36mlink\x1b[0m\ntracked\n\x1b[01;32muntracked\x1b[0m\n';

describe('stripAnsi', () => {
  it('leaves git status --short as its plain form', () => {
    expect(stripAnsi(GIT_STATUS)).toBe(' M tracked\n?? untracked\n');
  });

  it('strips git log and git diff colour, including the bare reset ESC[m', () => {
    expect(stripAnsi(GIT_LOG)).toBe('92973a1 init\n');
    expect(stripAnsi(GIT_DIFF)).toBe('diff --git a/tracked b/tracked\n@@ -1 +1,2 @@\n a\n');
  });

  it('strips ls --color, whose entries carry two sequences each', () => {
    expect(stripAnsi(LS)).toBe('dir\nlink\ntracked\nuntracked\n');
  });

  it('strips truecolor and cursor/erase sequences with private parameters', () => {
    expect(stripAnsi('\x1b[38;2;255;0;0mred\x1b[0m')).toBe('red');
    expect(stripAnsi('\x1b[?25l\x1b[2K\rprogress 50%\x1b[?25h')).toBe('\rprogress 50%');
  });

  it('strips OSC strings terminated by ST and by BEL, keeping the text between', () => {
    expect(stripAnsi('\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\ done')).toBe('link done');
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
  });

  it('strips two-byte escapes: charset, reset, save and restore cursor', () => {
    expect(stripAnsi('\x1b(Bmore\x1bc end')).toBe('more end');
    expect(stripAnsi('\x1b7saved\x1b8')).toBe('saved');
  });

  it('strips DCS and APC strings whole', () => {
    expect(stripAnsi('a\x1bPq#0;2;0;0;0\x1b\\b\x1b_Gf=100\x1b\\c')).toBe('abc');
  });

  it('touches nothing in plain text, brackets and tabs included', () => {
    const plain = '[ok] 3 files\t(1 changed)\r\n';
    expect(stripAnsi(plain)).toBe(plain);
  });

  it('is what the unstripped text is missing: a validator that strips nothing fails here', () => {
    expect(stripAnsi(GIT_STATUS)).not.toContain('\x1b');
    expect(stripAnsi(LS)).not.toContain('\x1b');
  });
});

describe('splitPendingEscape', () => {
  it('holds back a CSI cut before its final byte', () => {
    expect(splitPendingEscape(' M\x1b[3')).toEqual([' M', '\x1b[3']);
    expect(splitPendingEscape('x\x1b[')).toEqual(['x', '\x1b[']);
    expect(splitPendingEscape('x\x1b')).toEqual(['x', '\x1b']);
  });

  it('holds back an OSC that has not seen its terminator', () => {
    expect(splitPendingEscape('a\x1b]8;;https://exam')).toEqual(['a', '\x1b]8;;https://exam']);
  });

  it('releases a chunk that ends on a complete sequence, or on none', () => {
    expect(splitPendingEscape(' M\x1b[m')).toEqual([' M\x1b[m', '']);
    expect(splitPendingEscape('plain')).toEqual(['plain', '']);
    expect(splitPendingEscape('')).toEqual(['', '']);
  });

  it('reassembles across the boundary to what one read would have given', () => {
    const [head, pending] = splitPendingEscape(' \x1b[3');
    expect(stripAnsi(head) + stripAnsi(pending + '1mM\x1b[m tracked')).toBe(' M tracked');
  });
});
