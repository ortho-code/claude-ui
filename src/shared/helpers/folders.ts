/**
 * The app's own folders that Settings points people at, by name.
 * The window only ever names one; main alone knows the paths, so nothing the window sends is ever opened as a path.
 */
export type FolderName = 'config' | 'logs';
