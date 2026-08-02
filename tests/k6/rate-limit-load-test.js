/**
 * k6 load test for rate limiting
 *
 * Run with: k6 run tests/k6/rate-limit-load-test.js
 * Or with options: k6 run -u 10 -d 30s tests/k6/rate-limit-load-test.js
 *
 * Options:
 * -u/--vus: Number of virtual users (default: 10)
 * -d/--duration: Test duration (default: 30s)
 * -e/--env: Environment (default: http://localhost:3000)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Custom metrics
const rateLimitedRequests = new Rate('rate_limited_requests');

export const options = {
  stages: [
    { duration: '10s', target: 10 },   // Ramp up to 10 users
    { duration: '30s', target: 20 },   // Ramp up to 20 users
    { duration: '20s', target: 0 },    // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    rate_limited_requests: ['rate<0.5'], // Less than 50% rate limited
  },
};

export default function () {
  // Test: Multiple login attempts (should hit rate limit)
  const loginEmail = `user_${__VU}_${__ITER}@example.com`;
  const loginPayload = JSON.stringify({
    email: loginEmail,
    password: 'TestPassword123!',
  });

  const loginParams = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Make 10 login attempts in quick succession
  for (let i = 0; i < 10; i++) {
    const response = http.post(`${BASE_URL}/api/auth/signin`, loginPayload, loginParams);

    const isRateLimited = response.status === 429;
    rateLimitedRequests.add(isRateLimited);

    check(response, {
      'status is 401 or 429': (r) => r.status === 401 || r.status === 429,
      'has rate limit headers': (r) => r.headers['X-RateLimit-Limit'] !== undefined,
      'has retry after on 429': (r) => r.status !== 429 || r.headers['Retry-After'] !== undefined,
    });

    // Don't add sleep between attempts to test rate limit
    if (isRateLimited && i === 5) {
      // If we hit rate limit, wait before continuing
      sleep(3);
    }
  }

  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'tests/k6/results.json': JSON.stringify(data),
  };
}

/**
 * Simple text summary formatter
 */
function textSummary(data, options) {
  const indent = options.indent || '  ';
  const lines = [];

  lines.push('\n' + '='.repeat(70));
  lines.push('k6 Load Test Results');
  lines.push('='.repeat(70));

  if (data.metrics) {
    for (const [name, metric] of Object.entries(data.metrics)) {
      if (metric.values && metric.values.value) {
        lines.push(`${indent}${name}: ${metric.values.value.toFixed(2)}`);
      }
    }
  }

  if (data.custom_stats) {
    lines.push('\nCustom Metrics:');
    for (const [name, value] of Object.entries(data.custom_stats)) {
      lines.push(`${indent}${name}: ${JSON.stringify(value)}`);
    }
  }

  lines.push('='.repeat(70) + '\n');

  return lines.join('\n');
}
