import { File } from 'expo-file-system';
import type { SharedFile } from './share-intake';

/**
 * Deletes the cache copy of a shared file.
 *
 * A statement should not outlive the import that consumed it, and the owner
 * never chose to put this copy on the device — the share did. Safe to call
 * twice: a file that is already gone is the desired end state, so a failure
 * here is swallowed rather than raised at the owner.
 */
export async function discardShare(file: SharedFile): Promise<void> {
  try {
    const handle = new File(file.uri);
    if (handle.exists) handle.delete();
  } catch {
    // Nothing to report: the copy is either gone or not ours to remove. The
    // reason is not logged, because it would carry the file's name.
  }
}
