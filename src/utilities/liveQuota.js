import { LIVE_DAILY_QUOTA_SEC } from "../constants.js";
import { DailyLiveUsage } from "../models/dailyLiveUsage.model.js";
import { BroadcastSession } from "../models/broadcastSession.model.js";
import {
    ADD_QUOTA_LUA,
    getValkey,
    RELEASE_BROADCAST_LUA,
    RESERVE_BROADCAST_LUA,
} from "./valkey.js";
import {
    elapsedSecOnUtcDate,
    secondsUntilUtcMidnight,
    splitSecondsByUtcDay,
    utcDateString,
} from "./liveQuotaMath.js";

export {
    elapsedSecOnUtcDate,
    secondsUntilUtcMidnight,
    splitSecondsByUtcDay,
    utcDateString,
};

export async function getUsedSecondsFromMongo(userId, date = utcDateString()) {
    const usage = await DailyLiveUsage.findOne({ user: userId, date }).lean();
    return usage?.usedSeconds || 0;
}

export async function getActiveElapsedSecToday(userId, now = new Date()) {
    const session = await BroadcastSession.findOne({
        user: userId,
        status: "active",
    })
        .select("startedAt")
        .lean();

    if (!session?.startedAt) return 0;

    return elapsedSecOnUtcDate(session.startedAt, now, utcDateString(now));
}

export async function getQuotaBreakdown(userId) {
    const date = utcDateString();
    const finalizedUsedSec = await getUsedSecondsFromMongo(userId, date);
    const activeSessionSec = await getActiveElapsedSecToday(userId);
    const usedSec = finalizedUsedSec + activeSessionSec;
    const remainingSec = Math.max(0, LIVE_DAILY_QUOTA_SEC - usedSec);

    return {
        date,
        dailyQuotaSec: LIVE_DAILY_QUOTA_SEC,
        usedSec,
        finalizedUsedSec,
        activeSessionSec,
        remainingSec,
    };
}

export async function getRemainingQuotaSec(userId) {
    const { remainingSec } = await getQuotaBreakdown(userId);
    return remainingSec;
}

export async function syncQuotaCache(userId) {
    const redis = getValkey();
    const date = utcDateString();
    const used = await getUsedSecondsFromMongo(userId, date);
    const ttl = secondsUntilUtcMidnight() + 3600;
    await redis.set(`live:quota:${userId}:${date}`, used, "EX", ttl);
    return used;
}

export async function reserveBroadcastSlot(userId, streamId) {
    const redis = getValkey();
    const date = utcDateString();
    await syncQuotaCache(userId);

    const result = await redis.eval(
        RESERVE_BROADCAST_LUA,
        2,
        `live:active:${userId}`,
        `live:quota:${userId}:${date}`,
        streamId,
        String(LIVE_DAILY_QUOTA_SEC),
        String(Math.max(secondsUntilUtcMidnight(), LIVE_DAILY_QUOTA_SEC) + 120)
    );

    const ok = Number(result?.[0]) === 1;
    return {
        ok,
        code: result?.[1],
        used: Number(result?.[2] || 0),
        remaining: Math.max(0, LIVE_DAILY_QUOTA_SEC - Number(result?.[2] || 0)),
    };
}

export async function releaseBroadcastSlot(userId, streamId) {
    const redis = getValkey();
    await redis.eval(
        RELEASE_BROADCAST_LUA,
        1,
        `live:active:${userId}`,
        streamId
    );
}

export async function finalizeSession(session, reason = "ended") {
    if (!session || session.status === "finalized") {
        return session;
    }

    const endedAt = new Date();
    const startedAt = new Date(session.startedAt);
    const chunks = splitSecondsByUtcDay(startedAt, endedAt);
    let totalCharged = 0;

    for (const chunk of chunks) {
        const usage = await DailyLiveUsage.findOneAndUpdate(
            { user: session.user, date: chunk.date },
            {
                $setOnInsert: { usedSeconds: 0, finalizedSessionIds: [] },
            },
            { upsert: true, new: true }
        );

        if (usage.finalizedSessionIds.includes(session.sessionId)) {
            continue;
        }

        const roomLeft = Math.max(
            0,
            LIVE_DAILY_QUOTA_SEC - (usage.usedSeconds || 0)
        );
        const charge = Math.min(chunk.seconds, roomLeft);
        if (charge <= 0) {
            await DailyLiveUsage.updateOne(
                { _id: usage._id },
                { $addToSet: { finalizedSessionIds: session.sessionId } }
            );
            continue;
        }

        await DailyLiveUsage.updateOne(
            {
                _id: usage._id,
                finalizedSessionIds: { $ne: session.sessionId },
            },
            {
                $inc: { usedSeconds: charge },
                $addToSet: { finalizedSessionIds: session.sessionId },
            }
        );

        totalCharged += charge;

        try {
            const redis = getValkey();
            await redis.eval(
                ADD_QUOTA_LUA,
                1,
                `live:quota:${session.user}:${chunk.date}`,
                String(charge),
                String(LIVE_DAILY_QUOTA_SEC),
                String(secondsUntilUtcMidnight() + 3600)
            );
        } catch {
            // Mongo is source of truth; cache sync can catch up later
        }
    }

    const finalized = await BroadcastSession.findOneAndUpdate(
        { sessionId: session.sessionId, status: "active" },
        {
            $set: {
                status: "finalized",
                endedAt,
                finalizedAt: endedAt,
                chargedSeconds: totalCharged,
                finalizeReason: reason,
                lastCheckpointAt: endedAt,
            },
        },
        { new: true }
    );

    return finalized || session;
}

export async function recoverStaleSessions(maxAgeMs = 2 * 60 * 1000) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const stale = await BroadcastSession.find({
        status: "active",
        lastCheckpointAt: { $lt: cutoff },
    }).limit(50);

    const results = [];
    for (const session of stale) {
        const finalized = await finalizeSession(session, "stale_recovery");
        await releaseBroadcastSlot(session.user, session.streamId);
        results.push(finalized?.sessionId);
    }
    return results;
}
