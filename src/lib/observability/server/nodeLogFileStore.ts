// The server's log folder: plain files in a directory (LOG_FILE_DIR — a Docker volume in production). Server only
// (node:fs); the rotating sink itself knows nothing about it, it only sees the LogFileStore interface.
import { appendFileSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LogFileInfo, LogFileStore } from "../core/logFileStore";

/** File names come from the sink, never from a request, but a name with a separator in it is refused all the same. */
function safeName(name: string): string {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) throw new Error(`refusing to use "${name}" as a log file name`);
  return name;
}

export function createNodeLogFileStore(directory: string): LogFileStore {
  const inDirectory = (name: string) => path.join(directory, safeName(name));

  return {
    async ensure() {
      await mkdir(directory, { recursive: true });
    },
    async list() {
      const names = await readdir(directory);
      const files: LogFileInfo[] = [];
      for (const name of names) {
        try {
          const info = await stat(path.join(directory, name));
          if (info.isFile()) files.push({ name, size: info.size, modifiedAt: info.mtimeMs });
        } catch {
          // removed between the listing and the stat: it is no longer there to list
        }
      }
      return files;
    },
    async append(name, text) {
      await appendFile(inDirectory(name), text, "utf8");
    },
    appendSync(name, text) {
      appendFileSync(inDirectory(name), text, "utf8");
    },
    async read(name) {
      return new Uint8Array(await readFile(inDirectory(name)));
    },
    async write(name, data) {
      await writeFile(inDirectory(name), data);
    },
    async rename(from, to) {
      await rename(inDirectory(from), inDirectory(to));
    },
    async remove(name) {
      await unlink(inDirectory(name));
    },
  };
}
