import mongoose, { Schema } from "mongoose";

const dailyLiveUsageSchema = new Schema(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        date: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}-\d{2}$/,
        },
        usedSeconds: {
            type: Number,
            default: 0,
            min: 0,
        },
        finalizedSessionIds: {
            type: [String],
            default: [],
        },
    },
    { timestamps: true }
);

dailyLiveUsageSchema.index({ user: 1, date: 1 }, { unique: true });

export const DailyLiveUsage = mongoose.model(
    "DailyLiveUsage",
    dailyLiveUsageSchema
);
