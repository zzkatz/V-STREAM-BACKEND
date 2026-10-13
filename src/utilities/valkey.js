import Redis from "ioredis";

let client = null;

export function getValkey() {
    if (client) return client;

    const uri = process.env.VALKEY_SERVICE_URI;
    if (!uri) {
        throw new Error("VALKEY_SERVICE_URI is not configured");
    }

    client = new Redis(uri, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        connectTimeout: 10000,
        lazyConnect: false,
        tls: uri.startsWith("rediss://") ? {} : undefined,
    });

    client.on("error", (err) => {
        console.error("Valkey error:", err.message);
    });

    return client;
}

export async function valkeyHealthCheck() {
    const redis = getValkey();
    const pong = await redis.ping();
    return pong === "PONG";
}

/** Atomic: reserve active broadcaster lock if user has remaining quota. */
export const RESERVE_BROADCAST_LUA = `
local activeKey = KEYS[1]
local quotaKey = KEYS[2]
local streamId = ARGV[1]
local quotaLimit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local current = redis.call('GET', activeKey)
if current and current ~= streamId then
  return {0, 'ACTIVE_EXISTS', current}
end

local used = tonumber(redis.call('GET', quotaKey) or '0')
if used >= quotaLimit then
  return {0, 'QUOTA_EXCEEDED', used}
end

redis.call('SET', activeKey, streamId, 'EX', ttl)
return {1, 'OK', used}
`;

/** Finalize: clear active lock if owned by streamId. */
export const RELEASE_BROADCAST_LUA = `
local activeKey = KEYS[1]
local streamId = ARGV[1]
local current = redis.call('GET', activeKey)
if current == streamId then
  redis.call('DEL', activeKey)
  return 1
end
return 0
`;

/** Increment quota used seconds atomically, capped at limit. Returns new used. */
export const ADD_QUOTA_LUA = `
local quotaKey = KEYS[1]
local addSec = tonumber(ARGV[1])
local quotaLimit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local used = tonumber(redis.call('GET', quotaKey) or '0')
local nextUsed = math.min(quotaLimit, used + addSec)
redis.call('SET', quotaKey, nextUsed, 'EX', ttl)
return nextUsed
`;
