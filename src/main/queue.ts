/**
 * One job at a time per file: the way main keeps a read-modify-write of a file from overlapping another and dropping its change, and two writes from sharing the one temp file `writeFileAtomic` names per target.
 * A job queued after a failed one still runs, and the caller of the failed one still hears of the failure.
 */

const queues = new Map<string, Promise<unknown>>();

/** Run `job` once every job already queued for `file` is done. */
export function inTurn<T>(file: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(file) ?? Promise.resolve()).then(job);
  queues.set(
    file,
    run.catch(() => undefined),
  );
  return run;
}
