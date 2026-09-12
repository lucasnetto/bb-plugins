export const CATALOG_CONCURRENCY = 4;

// Wait for every started operation to stop before returning an error, so BB
// cannot begin cleanup while sibling checkouts are still writing to the VM.
export async function concurrently<T, R>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal,
  work: (item: T, signal: AbortSignal) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid concurrency limit.");
  signal.throwIfAborted();
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const results: R[] = [];
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!combined.aborted) {
        const index = next++;
        if (index >= items.length) return;
        try {
          results[index] = await work(items[index]!, combined);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
            controller.abort(error);
          }
          return;
        }
      }
    }),
  );
  if (failed) throw failure;
  signal.throwIfAborted();
  return results;
}

export async function overlap<A, B>(
  signal: AbortSignal,
  left: (signal: AbortSignal) => Promise<A>,
  right: (signal: AbortSignal) => Promise<B>,
): Promise<[A, B]> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let failed = false,
    failure: unknown;
  const cancel = (error: unknown): never => {
    if (!failed) {
      failed = true;
      failure = error;
      controller.abort(error);
    }
    throw error;
  };
  const results = await Promise.allSettled([
    Promise.resolve()
      .then(() => left(combined))
      .catch(cancel),
    Promise.resolve()
      .then(() => right(combined))
      .catch(cancel),
  ]);
  if (failed) throw failure;
  signal.throwIfAborted();
  if (results[0].status !== "fulfilled" || results[1].status !== "fulfilled")
    throw new Error("Parallel preparation failed.");
  return [results[0].value, results[1].value];
}
