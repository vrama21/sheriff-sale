import { createConcurrencyLimiter } from './createConcurrencyLimiter';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('createConcurrencyLimiter', () => {
  it('never runs more than `limit` tasks at once and runs every task', async () => {
    const limit = createConcurrencyLimiter(3);
    let active = 0;
    let maxActive = 0;
    let ran = 0;

    await Promise.all(
      Array.from({ length: 20 }, () =>
        limit(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await tick();
          active--;
          ran++;
        }),
      ),
    );

    expect(maxActive).toBe(3);
    expect(ran).toBe(20);
  });

  it('resolves each call with its own task result, in input order', async () => {
    const limit = createConcurrencyLimiter(2);

    const results = await Promise.all(
      [30, 10, 20, 0].map((delay, index) =>
        limit(async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));

          return index;
        }),
      ),
    );

    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('propagates rejections without stalling the queue', async () => {
    const limit = createConcurrencyLimiter(1);

    const results = await Promise.allSettled([
      limit(async () => {
        throw new Error('boom');
      }),
      limit(() => {
        throw new Error('sync boom');
      }),
      limit(async () => 'ok'),
    ]);

    expect(results).toEqual([
      { status: 'rejected', reason: new Error('boom') },
      { status: 'rejected', reason: new Error('sync boom') },
      { status: 'fulfilled', value: 'ok' },
    ]);
  });

  it('rejects an invalid limit', () => {
    expect(() => createConcurrencyLimiter(0)).toThrow('positive integer');
  });
});
