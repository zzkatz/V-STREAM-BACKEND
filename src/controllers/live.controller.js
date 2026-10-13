import { v4 as uuidv4 } from "uuid";
import { asyncHandler } from "../utilities/asyncHandler.js";
import { ApiError } from "../utilities/ApiError.js";
import { ApiResponse } from "../utilities/ApiResponse.js";
import { LiveStream } from "../models/liveStream.model.js";
import { BroadcastSession } from "../models/broadcastSession.model.js";
import {
    LIVE_DAILY_QUOTA_SEC,
    LIVE_HOST_GRACE_SEC,
    LIVE_MAX_CONCURRENT_VIEWERS,
    LIVE_MAX_DESCRIPTION_LENGTH,
    LIVE_MAX_TITLE_LENGTH,
} from "../constants.js";
import {
    createLiveRoom,
    deleteLiveRoom,
    getWebhookReceiver,
    mintRoomToken,
    removeParticipant,
} from "../utilities/livekit.js";
import {
    finalizeSession,
    getQuotaBreakdown,
    getRemainingQuotaSec,
    recoverStaleSessions,
    releaseBroadcastSlot,
    reserveBroadcastSlot,
    syncQuotaCache,
} from "../utilities/liveQuota.js";
import { getValkey } from "../utilities/valkey.js";
import { isLiveConfigured } from "../utilities/validateLiveEnv.js";
import { User } from "../models/user.model.js";
import {
    uploadOnCloudinary,
    deleteOnCloudinary,
    uploadLiveRecording,
} from "../utilities/cloudinary.js";

function requireLiveConfig() {
    if (!isLiveConfigured()) {
        throw new ApiError(
            503,
            "Live streaming is not configured on this server"
        );
    }
}

function publicStreamView(stream, broadcaster) {
    const recording = stream.recording || {};
    return {
        streamId: stream.streamId,
        title: stream.title,
        description: stream.description,
        thumbnail: stream.thumbnail?.url
            ? { url: stream.thumbnail.url }
            : null,
        status: stream.status,
        visibility: stream.visibility,
        startedAt: stream.startedAt,
        endedAt: stream.endedAt,
        durationSec: stream.durationSec,
        viewerCount: stream.viewerCount,
        recording: {
            url: recording.url || null,
            status: recording.status || "none",
            bytes: recording.bytes || 0,
            durationSec: recording.durationSec || 0,
        },
        broadcaster: broadcaster
            ? {
                  _id: broadcaster._id,
                  username: broadcaster.username,
                  fullName: broadcaster.fullName,
                  avatar: broadcaster.avatar
                      ? { url: broadcaster.avatar.url }
                      : null,
              }
            : undefined,
        createdAt: stream.createdAt,
    };
}

async function cancelHostGrace(streamId) {
    try {
        const redis = getValkey();
        await redis.del(`live:host-grace:${streamId}`);
    } catch {
        // ignore
    }
}

async function scheduleHostGraceEnd(stream) {
    const streamId = stream.streamId;
    const graceKey = `live:host-grace:${streamId}`;
    try {
        const redis = getValkey();
        await redis.set(graceKey, "1", "EX", LIVE_HOST_GRACE_SEC);
    } catch {
        // If Valkey unavailable, do not immediately end — wait briefly in-process
    }

    setTimeout(async () => {
        try {
            const redis = getValkey();
            const stillPending = await redis.get(graceKey);
            if (!stillPending) return;
            await redis.del(graceKey);
            const live = await LiveStream.findOne({
                streamId,
                status: "live",
            });
            if (live) {
                await endStreamInternal(live, "publisher_disconnected");
            }
        } catch (err) {
            console.error("Host grace finalize failed:", err.message);
        }
    }, LIVE_HOST_GRACE_SEC * 1000);
}

async function endStreamInternal(stream, reason) {
    if (!stream || stream.status === "ended") {
        return stream;
    }

    await cancelHostGrace(stream.streamId);

    const session = stream.sessionId
        ? await BroadcastSession.findOne({ sessionId: stream.sessionId })
        : null;

    if (session) {
        await finalizeSession(session, reason);
    }

    await releaseBroadcastSlot(stream.broadcaster, stream.streamId);
    await deleteLiveRoom(stream.roomName);

    const endedAt = new Date();
    const durationSec = stream.startedAt
        ? Math.max(0, Math.floor((endedAt - stream.startedAt) / 1000))
        : 0;

    stream.status = "ended";
    stream.endedAt = endedAt;
    stream.durationSec = durationSec;
    if (!stream.recording?.status || stream.recording.status === "none") {
        stream.recording = {
            ...(stream.recording?.toObject?.() || stream.recording || {}),
            status: "none",
            url: null,
            public_id: null,
        };
    }
    await stream.save();

    try {
        const redis = getValkey();
        await redis.del(`live:meta:${stream.streamId}`);
        await redis.del(`live:viewers:${stream.streamId}`);
    } catch {
        // ignore cache errors
    }

    return stream;
}

const getQuota = asyncHandler(async (req, res) => {
    requireLiveConfig();
    await recoverStaleSessions();
    await syncQuotaCache(req.user._id);
    const breakdown = await getQuotaBreakdown(req.user._id);
    const active = await LiveStream.findOne({
        broadcaster: req.user._id,
        status: "live",
    })
        .select("streamId")
        .lean();

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                ...breakdown,
                hasActiveStream: Boolean(active),
                activeStreamId: active?.streamId || null,
            },
            "Quota fetched"
        )
    );
});

const createStream = asyncHandler(async (req, res) => {
    requireLiveConfig();
    await recoverStaleSessions();

    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();
    const visibility =
        req.body?.visibility === "unlisted" ? "unlisted" : "public";

    if (!title || title.length > LIVE_MAX_TITLE_LENGTH) {
        throw new ApiError(
            400,
            `Title is required (max ${LIVE_MAX_TITLE_LENGTH} chars)`
        );
    }
    if (description.length > LIVE_MAX_DESCRIPTION_LENGTH) {
        throw new ApiError(
            400,
            `Description max ${LIVE_MAX_DESCRIPTION_LENGTH} chars`
        );
    }

    const existingLive = await LiveStream.findOne({
        broadcaster: req.user._id,
        status: "live",
    });
    if (existingLive) {
        throw new ApiError(409, "You already have an active live stream");
    }

    const remaining = await getRemainingQuotaSec(req.user._id);
    if (remaining <= 0) {
        throw new ApiError(403, "Daily live streaming quota exhausted");
    }

    const streamId = uuidv4();
    const sessionId = uuidv4();
    const roomName = `vestreams-${streamId}`;

    const reservation = await reserveBroadcastSlot(req.user._id, streamId);
    if (!reservation.ok) {
        if (reservation.code === "ACTIVE_EXISTS") {
            throw new ApiError(409, "You already have an active live stream");
        }
        throw new ApiError(403, "Daily live streaming quota exhausted");
    }

    try {
        await createLiveRoom(roomName);
    } catch (err) {
        await releaseBroadcastSlot(req.user._id, streamId);
        throw new ApiError(502, "Failed to create LiveKit room");
    }

    const startedAt = new Date();

    const stream = await LiveStream.create({
        streamId,
        broadcaster: req.user._id,
        title,
        description,
        roomName,
        status: "live",
        visibility,
        startedAt,
        sessionId,
    });

    await BroadcastSession.create({
        sessionId,
        streamId,
        user: req.user._id,
        roomName,
        status: "active",
        startedAt,
        lastCheckpointAt: startedAt,
    });

    const breakdown = await getQuotaBreakdown(req.user._id);

    return res.status(201).json(
        new ApiResponse(
            201,
            {
                ...publicStreamView(stream, req.user),
                remainingSec: breakdown.remainingSec,
                usedSec: breakdown.usedSec,
                finalizedUsedSec: breakdown.finalizedUsedSec,
                activeSessionSec: breakdown.activeSessionSec,
                dailyQuotaSec: breakdown.dailyQuotaSec,
                sessionId,
            },
            "Live stream created"
        )
    );
});

const listStreams = asyncHandler(async (req, res) => {
    requireLiveConfig();

    const streams = await LiveStream.find({
        status: "live",
        visibility: "public",
    })
        .sort({ startedAt: -1 })
        .limit(50)
        .populate("broadcaster", "username fullName avatar")
        .lean();

    return res.status(200).json(
        new ApiResponse(
            200,
            streams.map((s) => publicStreamView(s, s.broadcaster)),
            "Active public streams"
        )
    );
});

const getStream = asyncHandler(async (req, res) => {
    requireLiveConfig();
    const { id } = req.params;

    const stream = await LiveStream.findOne({ streamId: id })
        .populate("broadcaster", "username fullName avatar")
        .lean();

    if (!stream) {
        throw new ApiError(404, "Stream not found");
    }

    // Public listing vs unlisted: both require auth (middleware). Unlisted is
    // reachable by id; public also appears in list.
    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                publicStreamView(stream, stream.broadcaster),
                "Stream fetched"
            )
        );
});

const issueToken = asyncHandler(async (req, res) => {
    requireLiveConfig();
    const { id } = req.params;
    const role = req.body?.role === "publisher" ? "publisher" : "viewer";

    const stream = await LiveStream.findOne({ streamId: id });
    if (!stream) {
        throw new ApiError(404, "Stream not found");
    }
    if (stream.status !== "live") {
        throw new ApiError(410, "Stream is not live");
    }

    const isOwner =
        stream.broadcaster.toString() === req.user._id.toString();

    if (role === "publisher") {
        if (!isOwner) {
            throw new ApiError(403, "Only the broadcaster can publish");
        }

        const breakdown = await getQuotaBreakdown(req.user._id);
        if (breakdown.remainingSec <= 0) {
            await endStreamInternal(stream, "quota_exhausted");
            throw new ApiError(403, "Daily live streaming quota exhausted");
        }

        const session = await BroadcastSession.findOne({
            sessionId: stream.sessionId,
            status: "active",
        });
        if (session) {
            session.lastCheckpointAt = new Date();
            await session.save();
        }

        await cancelHostGrace(stream.streamId);

        const minted = await mintRoomToken({
            identity: `host-${req.user._id}`,
            name: req.user.username,
            roomName: stream.roomName,
            canPublish: true,
            ttlSec: breakdown.remainingSec,
        });

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    ...minted,
                    role: "publisher",
                    remainingSec: breakdown.remainingSec,
                    usedSec: breakdown.usedSec,
                    finalizedUsedSec: breakdown.finalizedUsedSec,
                    activeSessionSec: breakdown.activeSessionSec,
                    dailyQuotaSec: breakdown.dailyQuotaSec,
                    maxResolution: { width: 640, height: 360 },
                },
                "Publisher token issued"
            )
        );
    }

    // Viewer — auth required; public and unlisted both allowed when authenticated
    try {
        const redis = getValkey();
        const viewers = await redis.incr(`live:viewers:${stream.streamId}`);
        await redis.expire(`live:viewers:${stream.streamId}`, 3600);
        if (viewers > LIVE_MAX_CONCURRENT_VIEWERS) {
            await redis.decr(`live:viewers:${stream.streamId}`);
            throw new ApiError(429, "Stream viewer capacity reached");
        }
        stream.viewerCount = viewers;
        await stream.save();
    } catch (err) {
        if (err instanceof ApiError) throw err;
    }

    const minted = await mintRoomToken({
        identity: `viewer-${req.user._id}-${uuidv4().slice(0, 8)}`,
        name: req.user.username,
        roomName: stream.roomName,
        canPublish: false,
        ttlSec: Math.min(3600, LIVE_DAILY_QUOTA_SEC),
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                ...minted,
                role: "viewer",
            },
            "Viewer token issued"
        )
    );
});

const endStream = asyncHandler(async (req, res) => {
    requireLiveConfig();
    const { id } = req.params;

    const stream = await LiveStream.findOne({ streamId: id });
    if (!stream) {
        throw new ApiError(404, "Stream not found");
    }

    if (stream.broadcaster.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the broadcaster can end this stream");
    }

    const ended = await endStreamInternal(stream, "user_ended");
    const breakdown = await getQuotaBreakdown(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                ...publicStreamView(ended, req.user),
                remainingSec: breakdown.remainingSec,
                usedSec: breakdown.usedSec,
                finalizedUsedSec: breakdown.finalizedUsedSec,
                activeSessionSec: breakdown.activeSessionSec,
                dailyQuotaSec: breakdown.dailyQuotaSec,
            },
            "Stream ended"
        )
    );
});

const checkpoint = asyncHandler(async (req, res) => {
    requireLiveConfig();
    const { id } = req.params;

    const stream = await LiveStream.findOne({ streamId: id });
    if (!stream) {
        throw new ApiError(404, "Stream not found");
    }
    if (stream.broadcaster.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Not authorized");
    }
    if (stream.status !== "live") {
        throw new ApiError(410, "Stream is not live");
    }

    const session = await BroadcastSession.findOne({
        sessionId: stream.sessionId,
        status: "active",
    });

    if (session) {
        session.lastCheckpointAt = new Date();
        await session.save();
    }

    const breakdown = await getQuotaBreakdown(req.user._id);

    if (breakdown.remainingSec <= 0) {
        await removeParticipant(stream.roomName, `host-${req.user._id}`);
        await endStreamInternal(stream, "quota_exhausted");
        throw new ApiError(403, "Daily live streaming quota exhausted");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                remainingSec: breakdown.remainingSec,
                usedSec: breakdown.usedSec,
                finalizedUsedSec: breakdown.finalizedUsedSec,
                activeSessionSec: breakdown.activeSessionSec,
                dailyQuotaSec: breakdown.dailyQuotaSec,
                status: stream.status,
            },
            "Checkpoint ok"
        )
    );
});

const handleLiveWebhook = asyncHandler(async (req, res) => {
    requireLiveConfig();

    const receiver = getWebhookReceiver();
    const body =
        typeof req.body === "string" || Buffer.isBuffer(req.body)
            ? req.body
            : JSON.stringify(req.body);

    let event;
    try {
        event = await receiver.receive(body, req.get("Authorization"));
    } catch {
        throw new ApiError(401, "Invalid LiveKit webhook signature");
    }

    const eventId = event.id || `${event.event}-${event.createdAt}`;
    try {
        const redis = getValkey();
        const seen = await redis.set(
            `live:webhook:${eventId}`,
            "1",
            "EX",
            86400,
            "NX"
        );
        if (seen !== "OK") {
            return res.status(200).json({ ok: true, duplicate: true });
        }
    } catch {
        // proceed without dedupe if valkey unavailable
    }

    const roomName = event.room?.name;
    if (!roomName) {
        return res.status(200).json({ ok: true });
    }

    const stream = await LiveStream.findOne({ roomName, status: "live" });
    if (!stream) {
        return res.status(200).json({ ok: true });
    }

    if (event.event === "participant_joined") {
        const identity = event.participant?.identity || "";
        if (identity.startsWith("host-")) {
            await cancelHostGrace(stream.streamId);
        }
    }

    if (event.event === "participant_left") {
        const identity = event.participant?.identity || "";
        if (identity.startsWith("host-")) {
            await scheduleHostGraceEnd(stream);
        }
    }

    if (event.event === "room_finished") {
        await scheduleHostGraceEnd(stream);
    }

    return res.status(200).json({ ok: true });
});

const listMyStreams = asyncHandler(async (req, res) => {
    requireLiveConfig();
    const streams = await LiveStream.find({ broadcaster: req.user._id })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate("broadcaster", "username fullName avatar")
        .lean();

    return res.status(200).json(
        new ApiResponse(
            200,
            streams.map((s) => publicStreamView(s, s.broadcaster)),
            "Your livestreams"
        )
    );
});

const listStreamsByUsername = asyncHandler(async (req, res) => {
    requireLiveConfig();
    const { username } = req.params;
    const user = await User.findOne({
        username: {
            $regex: `^${String(username).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            $options: "i",
        },
    }).select("_id username fullName avatar");

    if (!user) {
        throw new ApiError(404, "Channel not found");
    }

    const streams = await LiveStream.find({ broadcaster: user._id })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

    return res.status(200).json(
        new ApiResponse(
            200,
            streams.map((s) => publicStreamView(s, user)),
            "Channel livestreams"
        )
    );
});

const updateStream = asyncHandler(async (req, res) => {
    requireLiveConfig();
    const { id } = req.params;
    const stream = await LiveStream.findOne({ streamId: id });

    if (!stream) {
        throw new ApiError(404, "Stream not found");
    }
    if (stream.broadcaster.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the owner can edit this stream");
    }
    if (!["live", "ended"].includes(stream.status)) {
        throw new ApiError(400, "Only live or ended streams can be edited");
    }

    if (req.body?.title !== undefined) {
        const title = String(req.body.title || "").trim();
        if (!title || title.length > LIVE_MAX_TITLE_LENGTH) {
            throw new ApiError(
                400,
                `Title is required (max ${LIVE_MAX_TITLE_LENGTH} chars)`
            );
        }
        stream.title = title;
    }

    if (req.body?.description !== undefined) {
        const description = String(req.body.description || "").trim();
        if (description.length > LIVE_MAX_DESCRIPTION_LENGTH) {
            throw new ApiError(
                400,
                `Description max ${LIVE_MAX_DESCRIPTION_LENGTH} chars`
            );
        }
        stream.description = description;
    }

    if (req.file?.path) {
        const uploaded = await uploadOnCloudinary(req.file.path);
        if (!uploaded?.secure_url) {
            throw new ApiError(500, "Thumbnail upload failed");
        }
        if (stream.thumbnail?.public_id) {
            await deleteOnCloudinary(stream.thumbnail.public_id);
        }
        stream.thumbnail = {
            url: uploaded.secure_url,
            public_id: uploaded.public_id,
        };
    }

    await stream.save();
    await stream.populate("broadcaster", "username fullName avatar");

    return res.status(200).json(
        new ApiResponse(
            200,
            publicStreamView(stream, stream.broadcaster),
            "Stream updated"
        )
    );
});

const deleteStream = asyncHandler(async (req, res) => {
    requireLiveConfig();
    const { id } = req.params;

    const stream = await LiveStream.findOne({ streamId: id });
    if (!stream) {
        throw new ApiError(404, "Stream not found");
    }
    if (stream.broadcaster.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the owner can delete this stream");
    }

    if (stream.status === "live") {
        await endStreamInternal(stream, "deleted");
    }

    const thumbnailId = stream.thumbnail?.public_id;
    const recordingId = stream.recording?.public_id;
    const sessionId = stream.sessionId;
    const streamId = stream.streamId;

    if (thumbnailId) {
        await deleteOnCloudinary(thumbnailId, "image");
    }
    if (recordingId) {
        await deleteOnCloudinary(recordingId, "video");
    }

    if (sessionId) {
        await BroadcastSession.deleteMany({
            $or: [{ sessionId }, { streamId }],
        });
    } else {
        await BroadcastSession.deleteMany({ streamId });
    }

    try {
        const redis = getValkey();
        await redis.del(`live:meta:${streamId}`);
        await redis.del(`live:viewers:${streamId}`);
        await redis.del(`live:host-grace:${streamId}`);
        await releaseBroadcastSlot(stream.broadcaster, streamId);
    } catch {
        // ignore cache errors
    }

    await LiveStream.deleteOne({ streamId });

    return res.status(200).json(
        new ApiResponse(
            200,
            { streamId },
            "Livestream deleted"
        )
    );
});

const uploadRecording = asyncHandler(async (req, res) => {
    requireLiveConfig();
    const { id } = req.params;

    const stream = await LiveStream.findOne({ streamId: id });
    if (!stream) {
        throw new ApiError(404, "Stream not found");
    }
    if (stream.broadcaster.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the broadcaster can upload a recording");
    }
    if (stream.status !== "ended") {
        throw new ApiError(400, "Recording can only be uploaded after the stream ends");
    }
    if (!req.file?.path) {
        throw new ApiError(400, "Recording file is required");
    }
    if (stream.recording?.status === "ready" && stream.recording?.url) {
        throw new ApiError(409, "Recording already uploaded for this stream");
    }

    stream.recording = {
        ...(stream.recording?.toObject?.() || stream.recording || {}),
        status: "processing",
        url: null,
        public_id: null,
    };
    await stream.save();

    const uploaded = await uploadLiveRecording(req.file.path);
    if (!uploaded?.playback_url) {
        stream.recording = {
            status: "failed",
            url: null,
            public_id: null,
            bytes: 0,
            durationSec: 0,
        };
        await stream.save();
        throw new ApiError(500, "Failed to upload and compress recording");
    }

    if (stream.recording?.public_id) {
        await deleteOnCloudinary(stream.recording.public_id, "video");
    }

    stream.recording = {
        status: "ready",
        url: uploaded.playback_url,
        public_id: uploaded.public_id,
        bytes: uploaded.playback_bytes || uploaded.bytes || 0,
        durationSec: Math.round(uploaded.playback_duration || uploaded.duration || 0),
    };
    await stream.save();
    await stream.populate("broadcaster", "username fullName avatar");

    return res.status(200).json(
        new ApiResponse(
            200,
            publicStreamView(stream, stream.broadcaster),
            "Recording saved"
        )
    );
});

export {
    getQuota,
    createStream,
    listStreams,
    getStream,
    issueToken,
    endStream,
    checkpoint,
    handleLiveWebhook,
    listMyStreams,
    listStreamsByUsername,
    updateStream,
    uploadRecording,
    deleteStream,
};
