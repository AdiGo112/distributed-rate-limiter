import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
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
    : `user-${Math.floor(Math.random() * 5000)}`;
  const plan = Math.random() < 0.2 ? 'pro' : 'free';
  const res = http.post(`${BASE_URL}/v1/check`, JSON.stringify({ key, plan }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'status is 200 or 429': (r) => r.status === 200 || r.status === 429 });
}
