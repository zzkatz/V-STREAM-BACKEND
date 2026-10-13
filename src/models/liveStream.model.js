import mongoose, { Schema } from "mongoose";

const liveStreamSchema = new Schema(
    {
        streamId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        broadcaster: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 500,
            default: "",
        },
        thumbnail: {
            type: {
                url: String,
                public_id: String,
            },
            default: null,
        },
        roomName: {
            type: String,
            required: true,
            unique: true,
        },
        status: {
            type: String,
            enum: ["scheduled", "live", "ended", "failed"],
            default: "scheduled",
            index: true,
        },
        visibility: {
            type: String,
            enum: ["public", "unlisted"],
            default: "public",
            index: true,
        },
        startedAt: {
            type: Date,
            default: null,
        },
        endedAt: {
            type: Date,
            default: null,
        },
        durationSec: {
            type: Number,
            default: 0,
        },
        viewerCount: {
            type: Number,
            default: 0,
        },
        sessionId: {
            type: String,
            default: null,
            index: true,
        },
        recording: {
            url: { type: String, default: null },
            public_id: { type: String, default: null },
            status: {
                type: String,
                enum: ["none", "processing", "ready", "failed"],
                default: "none",
            },
            bytes: { type: Number, default: 0 },
            durationSec: { type: Number, default: 0 },
        },
    },
    { timestamps: true }
);

liveStreamSchema.index({ status: 1, visibility: 1, startedAt: -1 });

export const LiveStream = mongoose.model("LiveStream", liveStreamSchema);
