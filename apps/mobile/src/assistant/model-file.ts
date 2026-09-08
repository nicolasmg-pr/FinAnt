import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Directory, File, Paths, type DownloadTask } from 'expo-file-system';

/**
 * The model file, and the one network request FinAnt makes.
 *
 * Read `docs/security-model.md` before changing anything here. The app is
 * otherwise offline by construction, and the rules that keep this exception
 * narrow — one host, one file, one explicit tap, no request body, nothing about
 * the owner transmitted — are load-bearing, not stylistic.
 */

export interface ModelSpec {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  /** Exact size in bytes. A mismatch fails in milliseconds, before any hashing. */
  readonly bytes: number;
  /** Lowercase hex SHA-256, as published alongside the file. */
  readonly sha256: string;
  readonly fileName: string;
  /** Enough for the system prompt, the id lists and one question. */
  readonly contextTokens: number;
}

/**
 * The only host this app ever asks for anything.
 *
 * Checked at runtime rather than trusted from the constant below, so a future
 * edit that points a spec somewhere else fails loudly instead of quietly
 * widening what "offline" means. Hugging Face redirects `resolve` URLs to its
 * CDN, so this pins where the request is *sent*, not where the bytes come from
 * — which is why the checksum, not the hostname, is what actually decides
 * whether the file is kept.
 */
const ALLOWED_HOST = 'https://huggingface.co/';

/**
 * Qwen's own GGUF repository publishes only Q8_0, which is 1.8 GB and too much
 * to hold resident next to an encrypted database on a 6 GB phone. Q4_K_M comes
 * from bartowski's conversion, which is where it exists — and the checksum
 * below is what makes that acceptable: it is the digest Hugging Face publishes
 * for the file, so the owner can compute it themselves and get the same answer,
 * and any other file is refused whatever it claims to be.
 */
export const QWEN3_1_7B: ModelSpec = {
  id: 'qwen3-1.7b-q4-k-m',
  label: 'Qwen3 1.7B',
  url: 'https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf',
  bytes: 1_282_439_584,
  sha256: '72c5c3cb38fa32d5256e2fe30d03e7a64c6c79e668ad84057e3bd66e250b24fb',
  fileName: 'Qwen_Qwen3-1.7B-Q4_K_M.gguf',
  contextTokens: 2048,
};

export const MODELS: readonly ModelSpec[] = [QWEN3_1_7B];

/**
 * Where the weights live.
 *
 * The document directory rather than the cache, because the cache is the one
 * place the OS is entitled to reclaim: losing a gigabyte the owner deliberately
 * downloaded, silently, between one launch and the next, is not a trade worth
 * making. The file is not encrypted — these are public weights, and SQLCipher
 * is for the ledger.
 */
function modelDirectory(): Directory {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function modelFile(spec: ModelSpec): File {
  return new File(modelDirectory(), spec.fileName);
}

export function isDownloaded(spec: ModelSpec): boolean {
  const file = modelFile(spec);
  return file.exists && file.size === spec.bytes;
}

export function hasRoomFor(spec: ModelSpec): boolean {
  // The download needs the file's own size; iOS also stages it in a temporary
  // location first, so ask for headroom rather than the exact figure.
  return Paths.availableDiskSpace > spec.bytes * 1.2;
}

/* -------------------------------------------------------------------------- */
/* Download                                                                   */
/* -------------------------------------------------------------------------- */

export interface DownloadProgressReport {
  readonly bytesWritten: number;
  readonly totalBytes: number;
}

/**
 * A pausable download of one model.
 *
 * Returns the task rather than a promise so the screen can drive pause, resume
 * and cancel: a gigabyte over a phone connection is long enough that not being
 * able to stop it is a defect.
 */
export function startDownload(
  spec: ModelSpec,
  onProgress: (report: DownloadProgressReport) => void,
): DownloadTask {
  if (!spec.url.startsWith(ALLOWED_HOST)) {
    throw new Error(`Model URL is not on the permitted host: ${spec.url}`);
  }
  // A leftover from a failed attempt would otherwise collide with the new one.
  // On Android a failed transfer can leave a partial file behind; on iOS it
  // cannot, but clearing it here means one rule rather than two.
  removeModel(spec);

  const task = File.createDownloadTask(spec.url, modelFile(spec), {
    // The default on iOS, stated because it is the reason a download survives
    // the owner leaving the app: a gigabyte is longer than anyone will watch.
    sessionType: 'background',
  });
  task.addListener('progress', (data) => {
    onProgress({ bytesWritten: data.bytesWritten, totalBytes: data.totalBytes });
  });
  return task;
}

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

export type VerifyResult = 'ok' | 'missing' | 'wrong-size' | 'not-a-model' | 'wrong-checksum';

/** Every GGUF file starts with these four bytes. */
const GGUF_MAGIC = 'GGUF';

/**
 * Checks the downloaded file is the one that was asked for.
 *
 * Three gates, cheapest first. Size and magic number cost microseconds and
 * catch a truncated download, an HTML error page saved under a .gguf name, or
 * the wrong quantisation — which is most of what actually goes wrong. Only then
 * does the SHA-256 run, and it runs over a stream: the file does not fit in
 * memory, and `expo-crypto` has no incremental digest.
 *
 * The hash is the one published with the file, so the owner can compute it
 * themselves and get the same answer. That is the point of pinning it rather
 * than inventing a cheaper construction of our own.
 */
export async function verify(
  spec: ModelSpec,
  onProgress: (fraction: number) => void,
): Promise<VerifyResult> {
  const file = modelFile(spec);
  if (!file.exists) return 'missing';
  if (file.size !== spec.bytes) return 'wrong-size';

  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...head) !== GGUF_MAGIC) return 'not-a-model';

  const hash = sha256.create();
  const reader = file.readableStream().getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    read += value.length;
    onProgress(read / spec.bytes);
  }

  return bytesToHex(hash.digest()) === spec.sha256 ? 'ok' : 'wrong-checksum';
}

export function removeModel(spec: ModelSpec): void {
  const file = modelFile(spec);
  if (file.exists) file.delete();
}
