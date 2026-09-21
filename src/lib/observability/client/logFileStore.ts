// Where the device's log files live. An interface, so the sink's rotation, retention and compression are
// testable with no phone around; the real store is a thin layer over @capacitor/filesystem (already a
// dependency — no new native plugin) and is only ever imported dynamically, so it never enters the web bundle.
import { base64ToBytes, bytesToBase64, utf8Bytes } from "./bytes";

export interface LogFileInfo {
  name: string;
  /** Bytes on disk. */
  size: number;
  /** Milliseconds since the epoch (0 when the platform does not say). */
  modifiedAt: number;
}

export interface LogFileStore {
  /** Creates the folder when it is missing. */
  ensure(): Promise<void>;
  list(): Promise<LogFileInfo[]>;
  /** Appends text to a file, creating it when missing. */
  append(name: string, text: string): Promise<void>;
  read(name: string): Promise<Uint8Array>;
  write(name: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(name: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// In memory: for tests, and as a stand-in anywhere a real folder is unavailable
// ---------------------------------------------------------------------------------------------

export interface MemoryStoreFaults {
  /** Thrown by the next call to that operation (once), e.g. a full disk on append. */
  once?: Partial<Record<"ensure" | "list" | "append" | "read" | "write" | "rename" | "remove", Error>>;
  /** Thrown by every call to that operation until cleared. */
  always?: Partial<Record<"ensure" | "list" | "append" | "read" | "write" | "rename" | "remove", Error>>;
}

export class MemoryLogFileStore implements LogFileStore {
  readonly files = new Map<string, { data: Uint8Array; modifiedAt: number }>();
  readonly faults: MemoryStoreFaults = {};
  /** Every call, in order, for assertions on how much I/O logging causes. */
  readonly calls: string[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  private check(operation: keyof NonNullable<MemoryStoreFaults["once"]>): void {
    this.calls.push(operation);
    const once = this.faults.once?.[operation];
    if (once) {
      delete this.faults.once![operation];
      throw once;
    }
    const always = this.faults.always?.[operation];
    if (always) throw always;
  }

  async ensure(): Promise<void> {
    this.check("ensure");
  }

  async list(): Promise<LogFileInfo[]> {
    this.check("list");
    return [...this.files.entries()].map(([name, file]) => ({ name, size: file.data.length, modifiedAt: file.modifiedAt }));
  }

  async append(name: string, text: string): Promise<void> {
    this.check("append");
    const added = utf8Bytes(text);
    const existing = this.files.get(name)?.data ?? new Uint8Array(0);
    const data = new Uint8Array(existing.length + added.length);
    data.set(existing, 0);
    data.set(added, existing.length);
    this.files.set(name, { data, modifiedAt: this.now() });
  }

  async read(name: string): Promise<Uint8Array> {
    this.check("read");
    const file = this.files.get(name);
    if (!file) throw new Error(`File does not exist: ${name}`);
    return file.data;
  }

  async write(name: string, data: Uint8Array): Promise<void> {
    this.check("write");
    this.files.set(name, { data, modifiedAt: this.now() });
  }

  async rename(from: string, to: string): Promise<void> {
    this.check("rename");
    const file = this.files.get(from);
    if (!file) throw new Error(`File does not exist: ${from}`);
    this.files.delete(from);
    this.files.set(to, file);
  }

  async remove(name: string): Promise<void> {
    this.check("remove");
    if (!this.files.delete(name)) throw new Error(`File does not exist: ${name}`);
  }

  /** Total bytes of everything stored. */
  totalBytes(): number {
    let total = 0;
    for (const file of this.files.values()) total += file.data.length;
    return total;
  }
}

// ---------------------------------------------------------------------------------------------
// The phone: the app's private storage through Capacitor
// ---------------------------------------------------------------------------------------------

/**
 * Files under `<app data>/<folder>/`. Private to the app, not visible to other apps or the file manager,
 * and removed with the app. Capacitor reads binary files as base64 and appends text with an encoding.
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
