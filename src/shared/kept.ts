/**
 * What one of the app's `.local.json` files keeps for a value: the value, or null where it is what would be in force without that file, so the file holds only what differs from yours.
 * A copy of your value there would hide a later edit of yours behind a value that only looked like a choice (docs/architecture.md § The config folder).
 * The one rule for the settings (`appFileChanges`) and the layout's folds and picks (panels/tree.ts).
 */
export function keptOver<T>(value: T, without: T): T | null {
  return value === without ? null : value;
}
