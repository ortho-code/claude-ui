import { ipcMain } from 'electron';
import type { NeedsYou, SetAside, SettledBy, SettledNeedsYou } from '../../shared/types';
import { cameDue, clearedSetAside, keptFrom, markedSetAside, markedWithHistory, restoredNeedsYou, settledNeedsYou, settledTypes, unkept } from '../../shared/status/session-marks';
import { needsYouUsage } from '../logs/usage';
import { decided, readMeta, serialize, update } from '../sessions/meta-store';

/** The sessions marked as needing you; see `needsYou`. */
export function getNeedsYou(): Promise<Record<string, NeedsYou[]>> {
  return serialize(async () => (await readMeta()).needsYou);
}

/** Mark sessions as needing you for `reasons`, each beside a session's other reasons and replacing one of its kind, which goes to its history (`markedWithHistory`). */
export function markNeedsYou(ids: string[], reasons: NeedsYou[]): Promise<void> {
  return update('markNeedsYou', (meta, usage) => {
    const before = meta.needsYou;
    Object.assign(meta, markedWithHistory(meta, ids, reasons, Date.now()));
    usage.push(...needsYouUsage(before, meta.needsYou, { by: 'replaced' }));
  });
}

/** Take a session's needs-you mark off, whether or not it had one, its reasons going to its history as settled by `by` (`settledNeedsYou`). */
export function clearNeedsYou(id: string, by: SettledBy): Promise<void> {
  return update('clearNeedsYou', (meta, usage) => {
    const before = meta.needsYou;
    Object.assign(meta, settledNeedsYou(meta, id, by, Date.now()));
    usage.push(...needsYouUsage(before, meta.needsYou, { by }));
  });
}

/** Put a session's reasons back as they were, as Undo of a close or a finish does, and take them back off its history (`restoredNeedsYou`). */
export function restoreNeedsYou(id: string, reasons: NeedsYou[]): Promise<void> {
  return update('restoreNeedsYou', (meta, usage) => {
    const before = meta.needsYou;
    Object.assign(meta, restoredNeedsYou(meta, id, reasons));
    usage.push(...needsYouUsage(before, meta.needsYou, { by: 'replaced', came: 'restored' }));
  });
}

/** Take every session's reasons of `types` off, each into its history as settled `off` (`settledTypes`): the types were switched off. */
export function settleNeedsYouTypes(types: string[]): Promise<void> {
  return update('settleNeedsYouTypes', (meta, usage) => {
    const before = meta.needsYou;
    Object.assign(meta, settledTypes(meta, types, Date.now()));
    usage.push(...needsYouUsage(before, meta.needsYou, { by: 'off' }));
  });
}

/** Each session's history of settled reasons; see `needsYouHistory`. */
export function getNeedsYouHistory(): Promise<Record<string, SettledNeedsYou[]>> {
  return serialize(async () => (await readMeta()).needsYouHistory);
}

/** The sessions set aside; see `setAside`. */
export function getSetAside(): Promise<Record<string, SetAside>> {
  return serialize(async () => (await readMeta()).setAside);
}

/** Set sessions aside, in one write, `due` the moment they come back, or null for whenever; a mark already there is replaced. */
export function markSetAside(ids: string[], due: number | null, at = Date.now()): Promise<void> {
  return update('markSetAside', (meta, usage) => {
    usage.push(...decided('setAside', ids));
    for (const id of ids) meta.setAside = markedSetAside(meta.setAside, id, due, at);
  });
}

/** Take sessions' set-aside marks off, in one write, whether or not each had one; `by` says a prompt there did, rather than you. */
export function clearSetAside(ids: string[], by?: 'prompt'): Promise<void> {
  return update('clearSetAside', (meta, usage) => {
    usage.push(...decided('clearSetAside', ids.filter((id) => id in meta.setAside), by));
    for (const id of ids) meta.setAside = clearedSetAside(meta.setAside, id);
  });
}

/** Settle the set-aside marks that have come due by `now`, by the rule the window keeps its copy by (`cameDue`), marking a reminder while `remind` says its type is on. */
export function setAsideCameDue(now: number, remind = true): Promise<void> {
  return update('setAsideCameDue', (meta, usage) => {
    const before = meta.needsYou;
    Object.assign(meta, cameDue(meta, now, remind));
    usage.push(...needsYouUsage(before, meta.needsYou, { by: 'replaced' }));
  });
}

/** When each session was last kept out of the review; see `kept`. */
export function getKept(): Promise<Record<string, number>> {
  return serialize(async () => (await readMeta()).kept);
}

/** Keep sessions out of the review from `at`, in one write (`keptFrom`). */
export function keep(ids: string[], at = Date.now()): Promise<void> {
  return update('keep', (meta, usage) => {
    usage.push(...decided('keep', ids));
    meta.kept = keptFrom(meta.kept, ids, at);
  });
}

/** Take sessions' keep stamps off, in one write, as Keep's Undo does. */
export function unkeep(ids: string[]): Promise<void> {
  return update('unkeep', (meta, usage) => {
    usage.push(...decided('unkeep', ids.filter((id) => id in meta.kept)));
    meta.kept = unkept(meta.kept, ids);
  });
}

/** The window's reads and writes of the needs-you, set-aside and keep marks. */
export function registerMarksIpc(): void {
  ipcMain.handle('meta:getNeedsYou', () => getNeedsYou());
  ipcMain.on('meta:settleNeedsYouTypes', (_event, types: string[]) => {
    void settleNeedsYouTypes(types);
  });
  ipcMain.on('meta:markNeedsYou', (_event, ids: string[], reasons: NeedsYou[]) => {
    void markNeedsYou(ids, reasons);
  });
  ipcMain.on('meta:clearNeedsYou', (_event, id: string, by: SettledBy) => {
    void clearNeedsYou(id, by);
  });
  ipcMain.on('meta:restoreNeedsYou', (_event, id: string, reasons: NeedsYou[]) => {
    void restoreNeedsYou(id, reasons);
  });
  ipcMain.handle('meta:getSetAside', () => getSetAside());
  ipcMain.handle('meta:getKept', () => getKept());
  ipcMain.on('meta:keep', (_event, ids: string[], at?: number) => {
    void keep(ids, at);
  });
  ipcMain.on('meta:unkeep', (_event, ids: string[]) => {
    void unkeep(ids);
  });
  ipcMain.on('meta:markSetAside', (_event, ids: string[], due: number | null, at?: number) => {
    void markSetAside(ids, due, at);
  });
  ipcMain.on('meta:clearSetAside', (_event, ids: string[], by: unknown) => {
    void clearSetAside(ids, by === 'prompt' ? by : undefined);
  });
  ipcMain.on('meta:setAsideCameDue', (_event, now: number, remind: boolean) => {
    void setAsideCameDue(now, remind);
  });
}
