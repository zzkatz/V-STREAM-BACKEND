import {
    AccessToken,
    RoomServiceClient,
    WebhookReceiver,
} from "livekit-server-sdk";
import { LIVE_TOKEN_MAX_TTL_SEC } from "../constants.js";

function getCredentials() {
    return {
        url: process.env.LIVEKIT_URL,
        apiKey: process.env.LIVEKIT_API_KEY,
        apiSecret: process.env.LIVEKIT_API_SECRET,
    };
}

export function getRoomService() {
    const { url, apiKey, apiSecret } = getCredentials();
    return new RoomServiceClient(url, apiKey, apiSecret);
}

export function getWebhookReceiver() {
    const { apiKey, apiSecret } = getCredentials();
    return new WebhookReceiver(apiKey, apiSecret);
}

export async function createLiveRoom(roomName, emptyTimeoutSec = 60) {
    const rooms = getRoomService();
    return rooms.createRoom({
        name: roomName,
        emptyTimeout: emptyTimeoutSec,
        maxParticipants: Number(process.env.LIVE_MAX_CONCURRENT_VIEWERS || 50) + 1,
    });
}

export async function deleteLiveRoom(roomName) {
    try {
        const rooms = getRoomService();
        await rooms.deleteRoom(roomName);
    } catch (err) {
        if (!String(err?.message || "").toLowerCase().includes("not found")) {
            console.error("Failed to delete LiveKit room:", err.message);
        }
    }
}

export async function removeParticipant(roomName, identity) {
    try {
        const rooms = getRoomService();
        await rooms.removeParticipant(roomName, identity);
    } catch (err) {
        console.error("Failed to remove participant:", err.message);
    }
}

export async function mintRoomToken({
    identity,
    name,
    roomName,
    canPublish,
    ttlSec,
}) {
    const { apiKey, apiSecret } = getCredentials();
    const ttl = Math.max(
        15,
        Math.min(Number(ttlSec) || LIVE_TOKEN_MAX_TTL_SEC, LIVE_TOKEN_MAX_TTL_SEC)
    );

    const at = new AccessToken(apiKey, apiSecret, {
        identity: String(identity),
        name: name || String(identity),
        ttl,
    });

    at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: Boolean(canPublish),
        canSubscribe: true,
        canPublishData: Boolean(canPublish),
    });

    return {
        token: await at.toJwt(),
        ttl,
        url: process.env.LIVEKIT_URL,
    };
}
