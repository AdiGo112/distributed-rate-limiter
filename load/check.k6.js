import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
// RATE set = benchmark: hold RATE req/s for 30s and print a JSON summary.
// RATE unset = demo traffic for the Grafana dashboard.
const RATE = Number(__ENV.RATE || 0);

export const options = RATE
  ? {
      scenarios: {
        stress: {
          executor: 'constant-arrival-rate',
          rate: RATE,
          timeUnit: '1s',
          duration: '30s',
          preAllocatedVUs: 300,
          maxVUs: 2000,
        },
      },
      summaryTrendStats: ['p(50)', 'p(95)', 'p(99)', 'max'],
    }
  : {
      scenarios: {
        // many users at a modest rate: mostly allowed
        normal: {
          executor: 'constant-arrival-rate',
          rate: 300,
          timeUnit: '1s',
          duration: '2m',
          preAllocatedVUs: 50,
        },
        // a few hot keys hammering: these get denied (429)
        abusers: {
          executor: 'constant-arrival-rate',
          rate: 100,
          timeUnit: '1s',
          duration: '2m',
          preAllocatedVUs: 20,
          env: { HOT: '1' },
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.01'], // 429s are expected, see responseCallback
        http_req_duration: ['p(99)<50'],
      },
    };

http.setResponseCallback(http.expectedStatuses(200, 429));

export default function () {
  const key = __ENV.HOT
    ? `abuser-${Math.floor(Math.random() * 3)}`
    : `user-${Math.floor(Math.random() * 10000)}`;
  const plan = Math.random() < 0.2 ? 'pro' : 'free';
  const res = http.post(`${BASE_URL}/v1/check`, JSON.stringify({ key, plan }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'status is 200 or 429': (r) => r.status === 200 || r.status === 429 });
}

export function handleSummary(data) {
  if (!RATE) return { stdout: '' }; // demo: keep k6's default end-of-test output off, Grafana is the view
  const m = data.metrics;
  const d = m.http_req_duration.values;
  return {
    stdout:
      JSON.stringify({
        target: RATE,
        achieved: Math.round(m.http_reqs.values.rate),
        p50: +d['p(50)'].toFixed(2),
        p95: +d['p(95)'].toFixed(2),
        p99: +d['p(99)'].toFixed(2),
        max: +d.max.toFixed(1),
        failed: m.http_req_failed.values.rate,
        dropped: m.dropped_iterations ? m.dropped_iterations.values.count : 0,
      }) + '\n',
  };
}
