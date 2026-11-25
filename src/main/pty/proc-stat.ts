/**
 * The fields of a `/proc/<pid>/stat` line after the command, which sits in parentheses and may itself hold spaces and parentheses.
 * Index 0 is the state, the line's third field, so the line's field n is at index n - 3.
 */
export function statFields(stat: string): string[] {
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ');
}
