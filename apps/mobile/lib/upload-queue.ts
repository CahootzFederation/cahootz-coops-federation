/**
 * Runs `worker` over `items` with at most `limit` running at once, keeping
 * results in input order. Uploading every attachment at once makes a big
 * video share the connection with all the photos, which on a phone can
 * outlast the upload token and fail the whole post.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  return results;
}

/**
 * Calls `attempt` again after a failure, up to `retries` more times, unless
 * `shouldRetry` says the error can't be fixed by trying again.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  { retries = 1, shouldRetry = () => true }: { retries?: number; shouldRetry?: (error: unknown) => boolean } = {},
): Promise<T> {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (tries >= retries || !shouldRetry(error)) throw error;
    }
  }
}
