import { buildOutputSchema, buildPrompt, type PromptInput } from '@finant/assistant';
import { initLlama, type LlamaContext } from 'llama.rn';
import { modelFile, type ModelSpec } from './model-file';

/**
 * The llama.cpp context, and the rules about when it is allowed to exist.
 *
 * A 1.3 GB model resident while the app is in the background is a jetsam kill
 * on iOS, so the context is held only while the sheet is open and is released
 * on close and on backgrounding. Between turns it stays alive deliberately: the
 * system prompt carries the whole category and account list, and re-encoding it
 * for every follow-up would dominate the latency.
 *
 * One context, module-scoped, because two would be two copies of the weights.
 */

/** Offload everything to the GPU where one is usable. See `loadModel`. */
const GPU_LAYERS = 99;

let context: LlamaContext | null = null;
let loadingFor: string | null = null;

export function isLoaded(): boolean {
  return context !== null;
}

export class OutOfMemoryError extends Error {}

export async function loadModel(
  spec: ModelSpec,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (context !== null && loadingFor === spec.id) return;
  await unloadModel();
  loadingFor = spec.id;

  const open = (gpuLayers: number): Promise<LlamaContext> =>
    initLlama(
      {
        model: modelFile(spec).uri,
        n_ctx: spec.contextTokens,
        n_gpu_layers: gpuLayers,
        use_mlock: false,
      },
      (progress) => onProgress?.(progress / 100),
    );

  try {
    try {
      context = await open(GPU_LAYERS);
    } catch {
      // Metal is not available everywhere, and this is not an edge case: the
      // iOS simulator cannot run it at all (llama.cpp uses more than the 14
      // constant buffers the simulator allows), and a device with a GPU older
      // than Apple7 cannot either. Both fail at init, and both work on the CPU,
      // so a second attempt is worth more than a diagnosis the owner cannot act
      // on. Only if that also fails is the load genuinely a failure.
      context = await open(0);
    }
  } catch (error) {
    loadingFor = null;
    context = null;
    // A phone that cannot hold the weights is a normal state, not a crash: the
    // screen offers a smaller model rather than an error.
    const message = error instanceof Error ? error.message : String(error);
    if (/memory|alloc|mmap/i.test(message)) throw new OutOfMemoryError(message);
    throw error;
  }
}

export async function unloadModel(): Promise<void> {
  const current = context;
  context = null;
  loadingFor = null;
  if (current !== null) await current.release();
}

export async function cancel(): Promise<void> {
  await context?.stopCompletion();
}

/**
 * One turn. Returns the model's raw text; reading it is `parsePatch`'s job.
 *
 * `json_schema` is llama.rn's route to grammar sampling, and the schema is
 * built per conversation with the owner's real ids as enums — so a category the
 * owner does not have is not a decoding path the model can take.
 *
 * Thinking is off. Qwen3 opens with a `<think>` block by default, which for a
 * turn whose entire output is nine possible keys costs seconds and buys
 * nothing.
 */
export async function ask(
  input: PromptInput,
  ids: { readonly categoryIds: readonly string[]; readonly accountIds: readonly string[] },
): Promise<string> {
  const active = context;
  if (active === null) throw new Error('ask() called before the model was loaded');

  const { system, user } = buildPrompt(input);

  const result = await active.completion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    jinja: true,
    enable_thinking: false,
    json_schema: JSON.stringify(buildOutputSchema(ids)),
    // A patch is nine short keys at the very most.
    n_predict: 256,
    temperature: 0,
  });

  return result.text;
}
