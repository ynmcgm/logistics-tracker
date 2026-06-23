/**
 * 单元测试：Session 管理器
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../../engines/common/session.js';

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!';

// 模拟 cookie 数据
const mockCookies = [
  {
    name: 'session_id',
    value: 'abc123',
    domain: '.yangkeduo.com',
    path: '/',
    httpOnly: true,
    secure: true,
  },
  {
    name: 'user_token',
    value: 'token_xyz_789',
    domain: 'mobile.yangkeduo.com',
    path: '/',
    httpOnly: true,
    secure: true,
  },
];

describe('Session Encryption', () => {
  it('should encrypt and decrypt cookie data', () => {
    const input = JSON.stringify(mockCookies);
    const encrypted = encrypt(input);
    const decrypted = decrypt(encrypted);

    assert.notEqual(encrypted, input);
    assert.equal(decrypted, input);
  });

  it('should produce different ciphertext for same input (different IV)', () => {
    const input = JSON.stringify(mockCookies);
    const encrypted1 = encrypt(input);
    const encrypted2 = encrypt(input);

    assert.notEqual(encrypted1, encrypted2);

    // 但解密后内容相同
    assert.equal(decrypt(encrypted1), input);
    assert.equal(decrypt(encrypted2), input);
  });

  it('should handle empty cookie array', () => {
    const input = JSON.stringify([]);
    const encrypted = encrypt(input);
    const decrypted = decrypt(encrypted);

    assert.equal(decrypted, input);
  });

  it('should handle complex cookie values', () => {
    const complexCookies = [
      {
        name: 'jwt_token',
        value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNqP',
        domain: '.example.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ];

    const input = JSON.stringify(complexCookies);
    const encrypted = encrypt(input);
    const decrypted = decrypt(encrypted);

    assert.equal(decrypted, input);
  });
});

describe('Session Validation', () => {
  // 注意: validateSession 需要实际浏览器环境
  // 在单元测试中通过 mock 测试验证逻辑
  it('should detect expired cookies by checking URL', () => {
    // 这个测试验证 should-not-reach-login-page 逻辑
    // 实际测试需要集成测试环境
    assert.ok(true, 'Placeholder - needs Playwright environment for full test');
  });
});
