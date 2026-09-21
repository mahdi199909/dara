// Where log files live: an interface, so the rotating sink's rotation, retention and compression are testable with no
// disk (or phone) around, and the real stores are thin layers — @capacitor/filesystem on the phone
// (client/capacitorLogFileStore.ts), node:fs on the server (server/nodeLogFileStore.ts).
import { utf8Bytes } from "./bytes";

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
  /**
   * The same, synchronously — for the last moments of a process that is exiting, when nothing asynchronous can finish.
   * Optional: only the server's store has it (a phone's filesystem plugin is asynchronous by nature).
   */
  appendSync?(name: string, text: string): void;
  read(name: string): Promise<Uint8Array>;
  write(name: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(name: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// In memory: for tests, and as a stand-in anywhere a real folder is unavailable
// ---------------------------------------------------------------------------------------------

type Operation = "ensure" | "list" | "append" | "appendSync" | "read" | "write" | "rename" | "remove";

export interface MemoryStoreFaults {
  /** Thrown by the next call to that operation (once), e.g. a full disk on append. */
  once?: Partial<Record<Operation, Error>>;
  /** Thrown by every call to that operation until cleared. */
  always?: Partial<Record<Operation, Error>>;
}

export class MemoryLogFileStore implements LogFileStore {
  readonly files = new Map<string, { data: Uint8Array; modifiedAt: number }>();
  readonly faults: MemoryStoreFaults = {};
  /** Every call, in order, for assertions on how much I/O logging causes. */
  readonly calls: string[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  private check(operation: Operation): void {
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
    this.appendNow(name, text);
  }

  appendSync(name: string, text: string): void {
    this.check("appendSync");
    this.appendNow(name, text);
  }

  private appendNow(name: string, text: string): void {
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
