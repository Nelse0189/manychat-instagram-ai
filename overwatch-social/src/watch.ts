import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** True when a process list line is the game, not this companion. */
export function processListHasOverwatch(stdout: string): boolean {
  return stdout.split(/\n/).some((line) => {
    if (/overwatch-social|overwatch-aftermatch/i.test(line)) return false;
    return /(?:^|[\s\\/"'])Overwatch(?:\.exe)?(?:\s|$)/i.test(line);
  });
}

export async function isOverwatchRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], {
        timeout: 5000,
        windowsHide: true,
      });
      return processListHasOverwatch(stdout);
    }
    const { stdout } = await execFileAsync("ps", ["-A", "-o", "args="], { timeout: 5000 });
    return processListHasOverwatch(stdout);
  } catch {
    return false;
  }
}
