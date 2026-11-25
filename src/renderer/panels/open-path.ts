import { editorSetKey, openInEditor, unlistedFile, type StepFile } from '../state/editor-tabs';
import { checkoutReads } from './checkout-reads';

/**
 * OPEN A FILE BY ITS PATH in the Editor, for the session on show, from anywhere that names one, such as a tool call in the history.
 * A file of a checkout opens as a checkout's file: compared with the question of the first reader still following that checkout, an Editor tab or the Explorer, else Since branched, stepping through that checkout's changed files; one the question lists no change in steps through itself only.
 * Any other file, and one of a checkout git cannot compare, is compared with the text it had when the session first changed it.
 * A preview unless `keep`, as a press on a row is; with `line`, that line in sight.
 */
export async function openPath(path: string, keep: boolean, line: number | null = null): Promise<void> {
  const session = editorSetKey();
  const checkout = await window.claudeUi.pathCheckout(path);
  const question = checkout ? (checkoutReads.followedQuestion(checkout.root) ?? 'since') : null;
  const read = checkout && question ? await checkoutReads.read(checkout.root, question) : null;
  if (!checkout || !question || read?.kind !== 'summary' || !read.summary.against) {
    if (session) openInEditor({ kind: 'session', session, path }, keep, line);
    return;
  }
  const { root, against, files } = read.summary;
  const listed = files.find((file) => file.path === checkout.file);
  const file = listed ?? unlistedFile(checkout.file);
  const steps = listed ? files.map((each): StepFile => ({ root, question, against, file: each })) : [{ root, question, against, file }];
  openInEditor({ kind: 'checkout', root, file, diff: { question, against }, files: steps }, keep, line);
}
