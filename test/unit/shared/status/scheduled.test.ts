import { describe, it, expect } from 'vitest';

import { startedByClaude } from '../../../../src/shared/status/scheduled';

// Measured on claude 2.1.310: a background task's end and a cron firing each fire UserPromptSubmit, the first with a <task-notification> prompt, the second with the prompt its Stop listed.
describe('startedByClaude', () => {
  it("takes a background task's end for claude's", () => {
    expect(startedByClaude('<task-notification>\n<task-id>bb4ve7a03</task-id>', [])).toBe(true);
  });

  it('takes a prompt that is exactly a scheduled task\'s for claude\'s', () => {
    expect(startedByClaude('Reply with the single word tick.', ['Reply with the single word tick.'])).toBe(true);
  });

  // Claude's hook schema names a `source`, which 2.1.310 did not yet send; where it comes, it decides.
  it('goes by where claude says the prompt came from, where it says', () => {
    expect(startedByClaude('Reply with the single word tick.', ['Reply with the single word tick.'], 'user')).toBe(false);
    expect(startedByClaude('fix the build', [], 'schedule_wakeup')).toBe(true);
    expect(startedByClaude('fix the build', [], 'loop_wakeup')).toBe(true);
  });

  it('takes anything else for yours, a prompt that only starts like a scheduled one included', () => {
    expect(startedByClaude('Reply with the single word tick. And tock.', ['Reply with the single word tick.'])).toBe(false);
    expect(startedByClaude('fix the build', [])).toBe(false);
    expect(startedByClaude('a note about <task-notification>', [])).toBe(false);
  });
});
