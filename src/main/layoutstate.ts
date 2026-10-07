import { ipcMain } from 'electron';
import { editAppFile, ownWrites, type AppFileChange } from './appfiles';
import { readJsoncFile } from './jsonc';
import { errorText, log } from './log';
import { getMoved, markMoved } from './meta';
import { defaultLocalLayoutFile } from './paths';
import { inTurn } from './queue';
import { ID_PATTERN, NODE_STATE_FIELDS, nodeStateProblem, withNodeChanges, type LocalLayoutRead, type NodeState, type NodeStateChange } from '../shared/panels';

/**
 * THE LAYOUT'S APP FILE, `layouts/default.local.json`: this machine's sizes, folds and picks, by node id, in the layout's own field names (`NodeState`), written as the window asks and read with the layout.
 * Main checks every change against the same rules the window reads the file by (shared/panels.ts), and writes through the one writer of the app's files (appfiles.ts).
 * What a node means, and whether an id is still in the layout, is the window's to know, since only it resolves the tree; main keeps the file.
 */

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The nodes the file holds, as written: an entry that is not an object is no node, and what is wrong inside one is the window's to say. */
function nodesIn(json: unknown): Record<string, NodeState> {
  if (!isObject(json) || !isObject(json.nodes)) return {};
  return Object.fromEntries(Object.entries(json.nodes).filter((entry): entry is [string, NodeState] => isObject(entry[1])));
}

/** The app's file as it stands, read in turn with the writes to it, so a read never answers with the file from before a write that was asked first. */
export async function readLocalLayout(file = defaultLocalLayoutFile): Promise<LocalLayoutRead> {
  const read = await inTurn(file, () => readJsoncFile(file));
  return { file, ...read, byApp: await ownWrites([file]), stateMoved: (await getMoved()).includes('panelState') };
}

/** What is wrong with a change the window asked for, or null; the window never sends one that is not, so this is main not taking its word for it. */
function changeProblem({ id, field, value }: NodeStateChange): string | null {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return `"${id}" is not a node's id.`;
  if (!NODE_STATE_FIELDS.includes(field)) return `${field} is not something the app keeps for a node.`;
  return value === null ? null : nodeStateProblem(field, value);
}

/**
 * Apply `changes` to the app's file, as edits by path: a field set or removed, and a node left with nothing removed whole, so the file holds only what is kept (`withNodeChanges`).
 * Called in turn (`inState`), since which node is left with nothing depends on the file as the change before left it.
 */
async function applyChanges(file: string, changes: NodeStateChange[]): Promise<void> {
  const after = withNodeChanges(nodesIn((await readJsoncFile(file)).json), changes);
  const edits: AppFileChange[] = changes.map(({ id, field, value }) =>
    after[id] === undefined ? { path: ['nodes', id], value: undefined } : { path: ['nodes', id, field], value: value ?? undefined },
  );
  if (edits.length > 0) await editAppFile(file, edits);
}

/** One change to the app's file at a time, each from reading it to writing it, refused with a reason rather than thrown, since the window shows it. */
function inState(file: string, job: () => Promise<void>): Promise<{ refused: string | null }> {
  return inTurn(`${file}#state`, () => job().then(
    () => ({ refused: null }),
    (error: unknown) => ({ refused: errorText(error) }),
  ));
}

/** What the window changed, kept. */
export function setLayoutState(changes: NodeStateChange[], file = defaultLocalLayoutFile): Promise<{ refused: string | null }> {
  const problem = changes.map(changeProblem).find((found) => found !== null);
  if (problem) return Promise.resolve({ refused: problem });
  return inState(file, () => applyChanges(file, changes));
}

/**
 * The tree's state from `meta.json`, as the window worked it out against the tree, into the app's file: once, recorded in `moved`, and not over nodes the file already holds.
 * Meta's copy is left where it is, so an older build still finds it; a move that fails is made again at the next launch.
 */
export function moveLayoutState(nodes: Record<string, NodeState>, file = defaultLocalLayoutFile): Promise<{ refused: string | null }> {
  const changes = Object.entries(nodes).flatMap(([id, state]) => NODE_STATE_FIELDS.flatMap((field) => (state[field] === undefined ? [] : [{ id, field, value: state[field] }])));
  const problem = changes.map(changeProblem).find((found) => found !== null);
  if (problem) return Promise.resolve({ refused: problem });
  return inState(file, async () => {
    if ((await getMoved()).includes('panelState')) return;
    const held = Object.keys(nodesIn((await readJsoncFile(file)).json)).length > 0;
    if (!held && changes.length > 0) await applyChanges(file, changes);
    await markMoved('panelState');
    log('info', 'layout', changes.length === 0 || held ? 'no sizes or folds to move from meta.json' : `this machine's sizes and folds moved from meta.json to ${file}`);
  });
}

export function registerLayoutState(): void {
  ipcMain.handle('config:setLayoutState', (_event, changes: NodeStateChange[]) => setLayoutState(changes));
  ipcMain.handle('config:moveLayoutState', (_event, nodes: Record<string, NodeState>) => moveLayoutState(nodes));
}
