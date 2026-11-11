import { describe, it, expect } from 'vitest';

import { rendererArguments } from '../../../../src/main/window/renderer-args';

describe("the window's renderer", () => {
  it('starts in the language the setting names, which is what a time field formats in', () => {
    expect(rendererArguments('en-GB')).toEqual(['--lang=en-GB']);
    expect(rendererArguments('nl-NL')).toEqual(['--lang=nl-NL']);
  });

  it("is left to the system's language when the setting names none", () => {
    expect(rendererArguments('')).toEqual([]);
  });
});
