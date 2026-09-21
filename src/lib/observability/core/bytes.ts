// Bytes <-> base64, for the one place a phone needs it: Capacitor's Filesystem plugin reads and writes binary
// files as base64 text. Built in chunks because String.fromCharCode(...bigArray) overflows the call stack.
const CHUNK = 8192;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Text(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

type StreamFactory = { CompressionStream?: new (format: string) => TransformStream; DecompressionStream?: new (format: string) => TransformStream };

async function through(stream: TransformStream, input: Uint8Array): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // (not awaited before reading: the stream's own back-pressure would otherwise wait for a reader that has not started)
  const written = writer.write(input as unknown as BufferSource as never).then(() => writer.close());
  written.catch(() => undefined); // a failure there surfaces through the reader below; it must not also be left unhandled
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  await written;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** True when this WebView (or Node) can gzip: the Android System WebView does since Chrome 80. */
export function canGzip(scope: StreamFactory = globalThis as StreamFactory): boolean {
  return typeof scope.CompressionStream === "function" && typeof scope.DecompressionStream === "function";
}

export async function gzip(bytes: Uint8Array, scope: StreamFactory = globalThis as StreamFactory): Promise<Uint8Array> {
  if (!scope.CompressionStream) throw new Error("gzip is not available in this runtime");
  return through(new scope.CompressionStream("gzip"), bytes);
}

export async function gunzip(bytes: Uint8Array, scope: StreamFactory = globalThis as StreamFactory): Promise<Uint8Array> {
  if (!scope.DecompressionStream) throw new Error("gunzip is not available in this runtime");
  return through(new scope.DecompressionStream("gzip"), bytes);
}
