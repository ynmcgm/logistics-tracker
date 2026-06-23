/**
 * 单元测试：DB 适配器（内存回退模式）
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../../engines/common/db-adapter.js';

describe('DB Adapter (in-memory fallback)', () => {
  let db;

  before(async () => {
    // 通过设置无效 envId 触发内存回退
    // 注意：initSDK 会尝试加载 @cloudbase/node-sdk
    // 如果安装了该 SDK 但无凭据，会使用 CloudBase 适配器 → 测试中无 env 会失败
    // 所以我们直接测试 createMemoryDb 的行为
    db = await getDatabase('__test__no_sdk__');
  });

  it('should create a named collection', () => {
    const col = db.collection('test_sessions');
    assert.ok(col);
    assert.equal(typeof col.findOne, 'function');
    assert.equal(typeof col.insertOne, 'function');
    assert.equal(typeof col.updateOne, 'function');
  });

  it('should insert and find a document', async () => {
    const col = db.collection('test_sessions');
    const doc = { user_openid: 'user_001', platform: 'pdd', status: 'active' };
    const result = await col.insertOne(doc);
    assert.ok(result._id);
    assert.equal(result.user_openid, 'user_001');

    const found = await col.findOne({ user_openid: 'user_001' });
    assert.ok(found);
    assert.equal(found.platform, 'pdd');
  });

  it('should return null for missing documents', async () => {
    const col = db.collection('test_sessions');
    const found = await col.findOne({ user_openid: 'nonexistent' });
    assert.equal(found, null);
  });

  it('should update a document with $set', async () => {
    const col = db.collection('test_sessions');
    await col.insertOne({ user_openid: 'user_002', status: 'pending', count: 1 });
    
    await col.updateOne(
      { user_openid: 'user_002' },
      { $set: { status: 'active' } }
    );

    const updated = await col.findOne({ user_openid: 'user_002' });
    assert.equal(updated.status, 'active');
    assert.equal(updated.count, 1); // unchanged
  });

  it('should update a document with $inc', async () => {
    const col = db.collection('test_sessions');
    
    await col.updateOne(
      { user_openid: 'user_002' },
      { $inc: { fail_count: 1 } }
    );

    const updated = await col.findOne({ user_openid: 'user_002' });
    assert.equal(updated.fail_count, 1);
  });

  it('should upsert a document when options.upsert is true', async () => {
    const col = db.collection('test_parcels');

    await col.updateOne(
      { tracking_number: 'SF123456' },
      { $set: { status: 'transit' }, $setOnInsert: { created_at: '2026-01-01' } },
      { upsert: true }
    );

    const found = await col.findOne({ tracking_number: 'SF123456' });
    assert.ok(found);
    assert.equal(found.status, 'transit');
  });

  it('should handle multiple collections independently', async () => {
    const sessions = db.collection('sessions');
    const parcels = db.collection('parcels');

    await sessions.insertOne({ id: 1 });
    await parcels.insertOne({ id: 2 });

    assert.ok(await sessions.findOne({ id: 1 }));
    assert.equal(await sessions.findOne({ id: 2 }), null);
    assert.equal(await parcels.findOne({ id: 1 }), null);
    assert.ok(await parcels.findOne({ id: 2 }));
  });
});
