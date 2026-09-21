// The phone's log folder: files in the app's private storage through Capacitor. Only ever imported dynamically (it
// reaches for @capacitor/filesystem), so it never enters the web bundle.
import { base64ToBytes, bytesToBase64 } from "../core/bytes";
import type { LogFileStore } from "../core/logFileStore";

/**
 * Files under `<app data>/<folder>/`. Private to the app, not visible to other apps or the file manager, and removed
 * with the app. Capacitor reads binary files as base64 and appends text with an encoding.
 */
export function createCapacitorLogFileStore(folder = "logs"): LogFileStore {
  const load = () => import("@capacitor/filesystem");
  const pathOf = (name: string) => `${folder}/${name}`;

  return {
    async ensure() {
      const { Filesystem, Directory } = await load();
      try {
        await Filesystem.mkdir({ path: folder, directory: Directory.Data, recursive: true });
      } catch (error) {
        // "Directory exists" comes back as an error on some platform versions; it is what we wanted.
        if (!/exist/i.test(error instanceof Error ? error.message : String(error))) throw error;
      }
    },
    async list() {
      const { Filesystem, Directory } = await load();
      const { files } = await Filesystem.readdir({ path: folder, directory: Directory.Data });
      return files
        .filter((file) => file.type === "file")
        .map((file) => ({ name: file.name, size: file.size ?? 0, modifiedAt: typeof file.mtime === "number" ? file.mtime : 0 }));
    },
    async append(name, text) {
      const { Filesystem, Directory, Encoding } = await load();
      await Filesystem.appendFile({ path: pathOf(name), data: text, directory: Directory.Data, encoding: Encoding.UTF8 });
    },
    async read(name) {
      const { Filesystem, Directory } = await load();
      const { data } = await Filesystem.readFile({ path: pathOf(name), directory: Directory.Data });
      return base64ToBytes(data as string);
    },
    async write(name, data) {
      const { Filesystem, Directory } = await load();
      await Filesystem.writeFile({ path: pathOf(name), data: bytesToBase64(data), directory: Directory.Data });
    },
    async rename(from, to) {
      const { Filesystem, Directory } = await load();
      await Filesystem.rename({ from: pathOf(from), to: pathOf(to), directory: Directory.Data, toDirectory: Directory.Data });
    },
    async remove(name) {
      const { Filesystem, Directory } = await load();
      await Filesystem.deleteFile({ path: pathOf(name), directory: Directory.Data });
    },
  };
}
