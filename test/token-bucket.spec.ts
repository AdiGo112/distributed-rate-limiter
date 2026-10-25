import { TokenBucket } from '../src/limiter/core/token-bucket.js';
import { FakeClock } from '../src/limiter/core/clock.js';

describe('TokenBucket', () => {
  it('allows a burst up to capacity then denies', () => {
    const c = new FakeClock();
    const b = new TokenBucket(5, 1, c);
    for (let i = 0; i < 5; i++) expect(b.tryConsume().allowed).toBe(true);
    expect(b.tryConsume().allowed).toBe(false);
  });

  it('refills over time', () => {
    const c = new FakeClock();
    const b = new TokenBucket(2, 1, c);
    b.tryConsume(2);
    expect(b.tryConsume().allowed).toBe(false);
    c.advance(1000);
    expect(b.tryConsume().allowed).toBe(true);
  });

  it('never exceeds capacity after long idle', () => {
    const c = new FakeClock();
    const b = new TokenBucket(3, 10, c);
    c.advance(60_000);
    expect(b.tryConsume(3).allowed).toBe(true);
    expect(b.tryConsume().allowed).toBe(false);
  });

  it('reports a correct retryAfter', () => {
    const c = new FakeClock();
    const b = new TokenBucket(1, 2, c); // 2 tokens/sec
    b.tryConsume();
    expect(b.tryConsume().retryAfterMs).toBe(500);
  });
});
