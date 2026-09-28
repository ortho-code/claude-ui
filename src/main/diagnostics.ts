import { app } from 'electron';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { log } from './log';

export interface InstallFacts {
  packaged: boolean;
  /** `APPIMAGE`, which the AppImage runtime sets to the file being run. */
  appImage: string | undefined;
  execPath: string;
  /** electron-builder's `resources/package-type`, when the build has one. */
  packageType: string | null;
}

/**
 * How this copy was installed, as what can be SEEN rather than a label guessed from it.
 * A `.deb` has no mark of its own that the project chose: electron-builder writes `package-type` only as a side effect of the auto-update settings it infers, which this project does not use, so it is reported when present and never relied on.
 * The executable's path says the rest to anyone reading — `/opt/Claude UI/` is where the `.deb` puts it, and a Mac bundle run from `/Volumes/` is still inside its disk image.
 */
export function describeInstall({ packaged, appImage, execPath, packageType }: InstallFacts): string {
  if (!packaged) return 'source';
  if (appImage) return `AppImage ${appImage}`;
  return `packaged ${execPath}${packageType ? `, package-type ${packageType}` : ''}`;
}

function readPackageType(): string | null {
  try {
    return readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** The lines every log file opens with: which build, installed how, on what machine, drawn how. */
export function headerLines(launched: string): string[] {
  const install = describeInstall({
    packaged: app.isPackaged,
    appImage: process.env.APPIMAGE,
    execPath: process.execPath,
    packageType: readPackageType(),
  });
  const system = [`${os.type()} ${os.release()}`];
  if (process.platform === 'darwin') system.push(`macOS ${process.getSystemVersion()}`);
  if (process.env.WSL_DISTRO_NAME) system.push(`WSL ${process.env.WSL_DISTRO_NAME}`);
  const lines = [
    `claude-ui ${app.getVersion()} on ${process.platform} ${process.arch}, pid ${process.pid}, launched ${launched}`,
    `install ${install}`,
    `os ${system.join(', ')}`,
    `electron ${process.versions.electron}, chromium ${process.versions.chrome}, node ${process.versions.node}`,
  ];
  // Which display the window can reach is the first question about a blank or white one on Linux.
  if (process.platform === 'linux') {
    const env = (name: string): string => `${name}=${process.env[name] ?? '-'}`;
    lines.push(`display ${['XDG_SESSION_TYPE', 'DISPLAY', 'WAYLAND_DISPLAY'].map(env).join(' ')}`);
  }
  return lines;
}

/**
 * The GPU's feature status, logged each time it changes.
 * Only meaningful once `gpu-info-update` has fired, so it is a line of its own rather than part of the header; a change later in a run is a fallback worth seeing.
 */
export function logGpuStatus(): void {
  let logged = '';
  app.on('gpu-info-update', () => {
    const status = Object.entries(app.getGPUFeatureStatus())
      .map(([feature, state]) => `${feature}=${String(state)}`)
      .join(' ');
    if (status === logged) return;
    logged = status;
    log('info', 'gpu', status);
  });
}
