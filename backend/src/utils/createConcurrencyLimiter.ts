export type ConcurrencyLimiter = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Creates a limiter that runs at most `limit` tasks at once; the rest wait in FIFO order.
 * Each call resolves or rejects with its task's own result.
 */
export const createConcurrencyLimiter = (limit: number): ConcurrencyLimiter => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Concurrency limit must be a positive integer, got ${limit}`);
  }

  const queue: Array<() => void> = [];
  let active = 0;

  const next = () => {
    if (active >= limit) {
      return;
    }

    const start = queue.shift();

    if (start) {
      active++;
      start();
    }
  };

  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        // Promise.resolve().then() also routes a synchronous throw from task() into reject.
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });

      next();
    });
};
