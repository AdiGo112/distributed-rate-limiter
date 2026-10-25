export interface Clock {
  nowMs(): number;
}

export class SystemClock implements Clock {
  nowMs() {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  constructor(private t = 0) {}
  nowMs() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}
