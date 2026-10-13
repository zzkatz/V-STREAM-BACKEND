import mongoose, { Schema } from "mongoose";

const broadcastSessionSchema = new Schema(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        streamId: {
            type: String,
            required: true,
            index: true,
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        roomName: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: ["active", "finalized"],
            default: "active",
            index: true,
        },
        startedAt: {
            type: Date,
            required: true,
        },
        lastCheckpointAt: {
            type: Date,
            required: true,
        },
        endedAt: {
            type: Date,
            default: null,
        },
        chargedSeconds: {
            type: Number,
            default: 0,
            min: 0,
        },
        finalizedAt: {
            type: Date,
            default: null,
        },
        finalizeReason: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

broadcastSessionSchema.index({ user: 1, status: 1 });

export const BroadcastSession = mongoose.model(
    "BroadcastSession",
    broadcastSessionSchema
);
