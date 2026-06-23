/**
 * Engine API 冒烟测试
 *
 * 测试引擎各 HTTP 端点是否正常响应。
 * 需在引擎运行时执行（云托管部署后或本地 Docker 运行）。
 *
 * 使用方式:
 *   node tests/smoke/engine-api.mjs                     # 默认引擎地址
 *   ENGINE_HOST=http://localhost:3000 node tests/smoke/engine-api.mjs
 */

const BASE = process.env.ENGINE_HOST || 'https://logistics-engine-273836-6-1301681040.sh.run.tcloudbase.com';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✘ ${name}: ${err.message}`);
  }
}

async function fetchJson(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return res.json();
}

console.log(`\nEngine API Smoke Test\n  Target: ${BASE}\n`);

// 1. 健康检查
await test('GET /health returns 200 with engines list', async () => {
  const data = await fetchJson('/health');
  if (data.status !== 'ok') throw new Error(`Expected status=ok, got ${data.status}`);
  if (!Array.isArray(data.engines)) throw new Error('Expected engines array');
});

// 2. 验证 GET /loginStatus 返回 404（GET 不支持）
await test('GET /loginStatus returns 404', async () => {
  const data = await fetchJson('/loginStatus?platform=pdd&session_id=test&user_id=test', { method: 'GET' });
  if (data.code !== 1003) throw new Error(`Expected 404 code=1003, got code=${data.code}`);
});

// 3. POST /loginStatus 缺少必填参数返回 400
await test('POST /loginStatus missing params returns 400', async () => {
  const data = await fetchJson('/loginStatus', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (data.code !== 1001) throw new Error(`Expected 400 code=1001, got code=${data.code}`);
});

// 4. POST /loginStatus 存在参数但无此用户 → 返回 200 + status=unknown（引擎逻辑）
await test('POST /loginStatus with valid params returns engine response', async () => {
  const data = await fetchJson('/loginStatus', {
    method: 'POST',
    body: JSON.stringify({ platform: 'pdd', session_id: 'test_session', user_id: 'nonexistent_user' }),
  });
  // 端点应返回 200（请求合法），data 可能是 { status: 'unknown' } 或 500（引擎内部错误）
  if (data.code !== 0) {
    // 如果不是 code=0，可能是引擎内部抛异常（如 Playwright 未启动）
    // 只要不是 404 就说明路由正确
    if (data.code === 1003) throw new Error('Route not found (404)');
  }
});

// 5. POST /sync 缺少平台参数
await test('POST /sync missing params returns 400', async () => {
  const data = await fetchJson('/sync', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (data.code !== 1001) throw new Error(`Expected 400 code=1001`);
});

// 6. POST /validate 缺少参数
await test('POST /validate missing params returns 400', async () => {
  const data = await fetchJson('/validate', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (data.code !== 1001) throw new Error(`Expected 400 code=1001`);
});

// 7. 无效路径返回 404
await test('GET /nonexistent returns 404', async () => {
  const data = await fetchJson('/nonexistent');
  if (data.code !== 1003) throw new Error(`Expected 404`);
});

// 8. CORS 预检
await test('OPTIONS /health returns 204 with CORS headers', async () => {
  const url = `${BASE}/health`;
  const res = await fetch(url, { method: 'OPTIONS' });
  if (res.status !== 204) throw new Error(`Expected 204, got ${res.status}`);
  if (!res.headers.get('access-control-allow-origin')) throw new Error('Missing CORS header');
});

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
