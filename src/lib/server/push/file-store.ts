/**
 * A JSON document on disk, written atomically and debounced.
 *
 * The push store is small (≤ 10,000 records), lives in memory, and is written
 * back after changes. Two properties matter more than speed:
 *
 * - **Atomic replacement.** Each save writes a temp file in the same
 *   directory, fsyncs it, then `rename`s it over the target. POSIX rename is
 *   atomic within a filesystem, so a crash or a full disk mid-write leaves the
 *   previous complete file, never half of a new one. Files are 0600 and the
 *   directory 0700: the store holds push endpoints (capability URLs) and the
 *   addresses each one watches.
 * - **Coalesced writes.** The poller touches records every minute; saves are
 *   debounced and serialised, and a burst of changes during a write produces
 *   one more write, not one per change.
 *
 * Generic and free of Next or secrets, so the I/O itself is tested against a
 * temp directory. A file that cannot be parsed is moved aside
 * (`*.corrupt-<time>`) rather than overwritten, so an operator can inspect it.
 */

import { mkdirSync, renameSync, writeFileSync, unlinkSync, openSync, fsyncSync, closeSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

function tempPath(path: string): string {
  return `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
}

export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = tempPath(path);
  try {
    const handle = await open(temp, "w", 0o600);
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** The same, synchronously: for the last save on process exit, where async work never finishes. */
export function writeFileAtomicSync(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = tempPath(path);
  try {
    writeFileSync(temp, data, { encoding: "utf8", mode: 0o600 });
    const fd = openSync(temp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      /* already gone */
    }
    throw error;
  }
}

export interface JsonFileOptions {
  /** Quiet period before a scheduled save runs (default 2 s). */
  readonly debounceMs?: number;
  /** Where save failures are reported (never with the file's contents). */
  readonly onError?: (error: unknown) => void;
}

export class JsonFile {
  readonly path: string;
  private readonly debounceMs: number;
  private readonly onError: (error: unknown) => void;
  private snapshot: (() => string) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> | null = null;
  private dirty = false;
  /** Completed writes, for tests and diagnostics. */
  writes = 0;

  constructor(path: string, options: JsonFileOptions = {}) {
    this.path = path;
    this.debounceMs = options.debounceMs ?? 2_000;
    this.onError = options.onError ?? (() => undefined);
  }

  /** The parsed document; null when there is none (or it was unreadable and moved aside). */
  async read(): Promise<unknown> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      await rename(this.path, `${this.path}.corrupt-${Date.now()}`).catch(() => undefined);
      this.onError(error);
      return null;
    }
  }

  /** Schedules a save of whatever `snapshot()` returns when the save runs. */
  schedule(snapshot: () => string): void {
    this.snapshot = snapshot;
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(this.onError);
    }, this.debounceMs);
    this.timer.unref?.();
  }

  /** Writes now if anything is pending; resolves when the file on disk is current. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Serialise: wait for an in-flight write, then write again only if
    // something changed meanwhile.
    while (this.writing) await this.writing.catch(() => undefined);
    if (!this.dirty || !this.snapshot) return;
    const snapshot = this.snapshot;
    this.dirty = false;
    this.writing = writeFileAtomic(this.path, snapshot()).then(
      () => {
        this.writes += 1;
      },
      (error: unknown) => {
        this.dirty = true;
        throw error;
      },
    );
    try {
      await this.writing;
    } finally {
      this.writing = null;
    }
    if (this.dirty) await this.flush();
  }

  /** Last-chance synchronous save (process `exit`). */
  flushSync(): void {
    if (!this.dirty || !this.snapshot) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeFileAtomicSync(this.path, this.snapshot());
    this.dirty = false;
    this.writes += 1;
  }

  get pending(): boolean {
    return this.dirty;
  }
}
