/**
 * DB 适配器
 *
 * 将 engine 中使用的 MongoDB 风格操作（findOne/insertOne/updateOne）
 * 适配到 CloudBase SDK API。
 *
 * 在 CloudBase CloudRun 环境中自动使用 @cloudbase/node-sdk；
 * 在无 SDK 环境下回退到内存存储（开发/测试用）。
 */

let cloudbase = null;

async function initSDK() {
  if (cloudbase) return cloudbase;

  // 优先尝试 CloudBase Node SDK
  try {
    cloudbase = await import('@cloudbase/node-sdk');
    cloudbase = cloudbase.default || cloudbase;
  } catch {
    try {
      cloudbase = await import('wx-server-sdk');
      cloudbase = cloudbase.default || cloudbase;
    } catch {
      cloudbase = null;
    }
  }
  return cloudbase;
}

/**
 * 创建内存数据库（开发/测试用）
 */
function createMemoryDb() {
  const stores = {};
  return {
    collection(name) {
      if (!stores[name]) stores[name] = [];
      return {
        async findOne(query) {
          return stores[name].find(doc =>
            Object.entries(query).every(([k, v]) => doc[k] === v)
          ) || null;
        },
        async insertOne(doc) {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const full = { _id: id, ...doc };
          stores[name].push(full);
          return { insertedId: id, ...full };
        },
        async updateOne(filter, update, options = {}) {
          const { $set = {}, $inc = {}, $setOnInsert = {} } = update;
          const idx = stores[name].findIndex(doc =>
            Object.entries(filter).every(([k, v]) => doc[k] === v)
          );

          if (idx >= 0) {
            const doc = stores[name][idx];
            for (const [k, v] of Object.entries($set)) doc[k] = v;
            for (const [k, v] of Object.entries($inc)) doc[k] = (doc[k] || 0) + v;
            stores[name][idx] = doc;
          } else if (options.upsert) {
            const insertData = { ...$set, ...$setOnInsert, ...filter };
            await this.insertOne(insertData);
          }
        },
      };
    },
  };
}

/**
 * 创建 CloudBase 数据库适配器
 */
async function createCloudbaseDb(envId) {
  const sdk = await initSDK();
  const app = sdk.init(envId ? { env: envId } : {});
  const db = app.database();
  const _ = db.command;

  return {
    collection(name) {
      const col = db.collection(name);

      async function findOne(query) {
        const result = await col.where(query).get();
        return result.data?.length > 0 ? result.data[0] : null;
      }

      async function insertOne(doc) {
        const result = await col.add({ data: doc });
        return { _id: result.id, ...doc };
      }

      async function updateOne(filter, update, options = {}) {
        const { $set = {}, $inc = {}, $setOnInsert = {} } = update;

        if (options.upsert) {
          // CloudBase SDK 不支持原生 upsert，手动实现
          const existing = await findOne(filter);
          if (existing) {
            await col.where(filter).update({ data: $set });
          } else {
            const insertData = { ...$set, ...$setOnInsert, ...filter };
            await col.add({ data: insertData });
          }
          return;
        }

        // 构建 update data
        const data = { ...$set };

        // $inc：CloudBase 通过 command.inc 支持
        for (const [key, val] of Object.entries($inc)) {
          data[key] = _.inc(val);
        }

        await col.where(filter).update({ data });
      }

      return { findOne, insertOne, updateOne };
    },
  };
}

/**
 * 获取数据库适配器实例
 *
 * @param {string} envId - CloudBase 环境 ID（可选，自动从环境变量读取）
 * @returns {object} - 包含 collection() 方法的对象
 */
export async function getDatabase(envId) {
  const resolvedEnvId = envId || process.env.TCB_ENV_ID || process.env.ENV_ID;

  const sdkLoaded = await initSDK();
  if (sdkLoaded) {
    console.log('[DB] Using CloudBase SDK adapter' + (resolvedEnvId ? ` (env: ${resolvedEnvId})` : ''));
    return createCloudbaseDb(resolvedEnvId);
  }

  console.warn('[DB] CloudBase SDK not available, using in-memory fallback');
  return createMemoryDb();
}

export default { getDatabase };
