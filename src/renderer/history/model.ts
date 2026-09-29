import type { Exchange, HistorySlice } from '../../shared/types';

/** What the window holds of one session's history: the exchanges, and which read of the transcript they come from. */
export interface HistoryModel {
  generation: number;
  exchanges: Exchange[];
}

export function emptyModel(): HistoryModel {
  return { generation: 0, exchanges: [] };
}

/**
 * Apply a read of the transcript, and say from which exchange on anything changed, so only those are drawn again.
 * Another generation means the transcript was read again from the start, so everything held is replaced.
 */
export function applySlice(model: HistoryModel, slice: HistorySlice): number {
  if (slice.generation !== model.generation) {
    model.generation = slice.generation;
    model.exchanges = [...slice.exchanges];
    return 0;
  }
  model.exchanges.splice(slice.from, model.exchanges.length - slice.from, ...slice.exchanges);
  return slice.from;
}

/** The first line of a request, cut for a label: what a tooltip or a list names it by. */
export function requestLabel(request: string, max = 120): string {
  const first = request.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
