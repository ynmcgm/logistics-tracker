/**
 * 引擎 HTTP 服务
 *
 * 运行在 CloudBase 云托管（Docker）中。
 * 提供 API 供云函数调用，执行实际的 Playwright 自动化操作。
 */
import http from 'node:http';
import { URL } from 'node:url';
import { getBrowser, closeAll } from './common/browser.js';
import { getDatabase } from './common/db-adapter.js';

// 引擎注册表：按平台名获取引擎实例
const engineRegistry = {};

/**
 * 注册所有已启用的平台引擎
 */
async function initEngines() {
  const enabled = (process.env.PLATFORMS || 'pdd').split(',').map(s => s.trim());

  // 使用 DB 适配器（CloudRun 中自动使用 CloudBase SDK，否则 fallback 内存 DB）
  const db = await getDatabase();

  if (enabled.includes('pdd')) {
    const { default: PDDEngine } = await import('./pdd/index.js');
    engineRegistry.pdd = new PDDEngine(db);
    console.log('[Engine] PDD engine registered');
  }
  if (enabled.includes('jd')) {
    console.log('[Engine] JD engine not yet implemented');
  }
  if (enabled.includes('taobao')) {
    console.log('[Engine] Taobao engine not yet implemented');
  }
}

/**
 * 解析请求体 JSON
 */
function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
function jsonResponse(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(data));
}

/**
 * 路由处理
 */
async function handleRequest(request, response) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    jsonResponse(response, 204, {});
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  const path = url.pathname;
  const method = request.method;

  try {
    // Health check
    if (path === '/health' && method === 'GET') {
      jsonResponse(response, 200, { status: 'ok', engines: Object.keys(engineRegistry) });
      return;
    }

    // POST /login - 发起登录
    if (path === '/login' && method === 'POST') {
      const body = await parseBody(request);
      const { platform, user_id } = body;

      if (!platform || !user_id) {
        jsonResponse(response, 400, { code: 1001, error: 'platform and user_id required' });
        return;
      }

      const engine = engineRegistry[platform];
      if (!engine) {
        jsonResponse(response, 400, { code: 1001, error: `Unsupported platform: ${platform}` });
        return;
      }

      const result = await engine.login(user_id);
      jsonResponse(response, 200, { code: 0, data: result });
      return;
    }

    // POST /sync - 触发订单同步
    if (path === '/sync' && method === 'POST') {
      const body = await parseBody(request);
      const { platform, user_id } = body;

      if (!platform || !user_id) {
        jsonResponse(response, 400, { code: 1001, error: 'platform and user_id required' });
        return;
      }

      const engine = engineRegistry[platform];
      if (!engine) {
        jsonResponse(response, 400, { code: 1001, error: `Unsupported platform: ${platform}` });
        return;
      }

      const result = await engine.syncOrders(user_id);
      jsonResponse(response, 200, { code: 0, data: result });
      return;
    }

    // POST /validate - 验证 session
    if (path === '/validate' && method === 'POST') {
      const body = await parseBody(request);
      const { platform, user_id } = body;

      if (!platform || !user_id) {
        jsonResponse(response, 400, { code: 1001, error: 'platform and user_id required' });
        return;
      }

      const engine = engineRegistry[platform];
      if (!engine) {
        jsonResponse(response, 400, { code: 1001, error: `Unsupported platform: ${platform}` });
        return;
      }

      const isValid = await engine.validate(user_id);
      jsonResponse(response, 200, { code: 0, data: { valid: isValid } });
      return;
    }

    // POST /loginStatus - 轮询扫码登录状态（无 DB，仅返回 QR 状态）
    if (path === '/loginStatus' && method === 'POST') {
      const body = await parseBody(request);
      const { platform, session_id, user_id } = body;

      if (!platform || !session_id || !user_id) {
        jsonResponse(response, 400, { code: 1001, error: 'platform, session_id and user_id required' });
        return;
      }

      const engine = engineRegistry[platform];
      if (!engine) {
        jsonResponse(response, 400, { code: 1001, error: `Unsupported platform: ${platform}` });
        return;
      }

      const result = await engine.checkLoginStatusRaw(session_id, user_id);
      jsonResponse(response, 200, { code: 0, data: result });
      return;
    }

    // POST /login/sms-start - 发起 SMS 验证码登录（第 1 步）
    if (path === '/login/sms-start' && method === 'POST') {
      const body = await parseBody(request);
      const { platform, user_id, phone } = body;

      if (!platform || !user_id || !phone) {
        jsonResponse(response, 400, { code: 1001, error: 'platform, user_id and phone required' });
        return;
      }

      const engine = engineRegistry[platform];
      if (!engine) {
        jsonResponse(response, 400, { code: 1001, error: `Unsupported platform: ${platform}` });
        return;
      }

      if (!engine.smsLogin) {
        jsonResponse(response, 400, { code: 1001, error: 'SMS login not supported for this platform' });
        return;
      }

      const result = await engine.smsLogin(user_id, phone);
      jsonResponse(response, 200, { code: 0, data: result });
      return;
    }

    // POST /login/sms-verify - 验证 SMS 码（第 2 步）
    if (path === '/login/sms-verify' && method === 'POST') {
      const body = await parseBody(request);
      const { platform, session_id, code } = body;

      if (!platform || !session_id || !code) {
        jsonResponse(response, 400, { code: 1001, error: 'platform, session_id and code required' });
        return;
      }

      const engine = engineRegistry[platform];
      if (!engine) {
        jsonResponse(response, 400, { code: 1001, error: `Unsupported platform: ${platform}` });
        return;
      }

      if (!engine.verifySms) {
        jsonResponse(response, 400, { code: 1001, error: 'SMS verification not supported for this platform' });
        return;
      }

      const result = await engine.verifySms(session_id, code);
      jsonResponse(response, 200, { code: 0, data: result });
      return;
    }

    // 404
    jsonResponse(response, 404, { code: 1003, error: 'Not found' });
  } catch (err) {
    console.error(`[Engine] Request error:`, err);
    jsonResponse(response, 500, { code: 1005, error: err.message });
  }
}

/**
 * 启动 HTTP 服务
 */
async function main() {
  const port = parseInt(process.env.PORT || '3000', 10);

  await initEngines();

  const server = http.createServer(handleRequest);

  // 优雅关闭
  const shutdown = async () => {
    console.log('[Engine] Shutting down...');
    server.close();
    await closeAll();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(port, () => {
    console.log(`[Engine] Server running on port ${port}`);
    console.log(`[Engine] Enabled platforms: ${process.env.PLATFORMS || 'pdd'}`);
  });
}

main().catch(err => {
  console.error('[Engine] Fatal startup error:', err);
  process.exit(1);
});
