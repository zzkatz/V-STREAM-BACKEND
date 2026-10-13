import mongoose, { isValidObjectId } from "mongoose";
import { Like } from "../models/like.model.js";
import { ApiResponse } from "../utilities/ApiResponse.js";
import { ApiError } from "../utilities/ApiError.js";
import { asyncHandler } from "../utilities/asyncHandler.js";

const typeMatch = (reactionType) =>
    reactionType === "like"
        ? {
              $or: [
                  { type: "like" },
                  { type: { $exists: false } },
                  { type: null },
              ],
          }
        : { type: "dislike" };

const toggleReaction = async ({
    filter,
    userId,
    reactionType,
    createPayload,
}) => {
    const existingReaction = await Like.findOne({
        ...filter,
        likedBy: userId,
        ...typeMatch(reactionType),
    });

    if (existingReaction) {
        await Like.findByIdAndDelete(existingReaction._id);
        return { active: false };
    }

    const oppositeType = reactionType === "like" ? "dislike" : "like";
    await Like.deleteMany({
        ...filter,
        likedBy: userId,
        ...typeMatch(oppositeType),
    });

    await Like.create({
        ...createPayload,
        likedBy: userId,
        type: reactionType,
    });

    return { active: true };
};

const toggleVideoLike = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    const result = await toggleReaction({
        filter: { video: videoId },
        userId: req.user?._id,
        reactionType: "like",
        createPayload: { video: videoId },
    });

    return res
        .status(200)
        .json(new ApiResponse(200, { isLiked: result.active }));
});

const toggleVideoDislike = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    const result = await toggleReaction({
        filter: { video: videoId },
        userId: req.user?._id,
        reactionType: "dislike",
        createPayload: { video: videoId },
    });

    return res
        .status(200)
        .json(new ApiResponse(200, { isDisliked: result.active }));
});

const toggleCommentLike = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid commentId");
    }

    const result = await toggleReaction({
        filter: { comment: commentId },
        userId: req.user?._id,
        reactionType: "like",
        createPayload: { comment: commentId },
    });

    return res
        .status(200)
        .json(new ApiResponse(200, { isLiked: result.active }));
});

const toggleCommentDislike = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid commentId");
    }

    const result = await toggleReaction({
        filter: { comment: commentId },
        userId: req.user?._id,
        reactionType: "dislike",
        createPayload: { comment: commentId },
    });

    return res
        .status(200)
        .json(new ApiResponse(200, { isDisliked: result.active }));
});

const toggleTweetLike = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweetId");
    }

    const result = await toggleReaction({
        filter: { tweet: tweetId },
        userId: req.user?._id,
        reactionType: "like",
        createPayload: { tweet: tweetId },
    });

    return res
        .status(200)
        .json(new ApiResponse(200, { isLiked: result.active }));
});

const toggleTweetDislike = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweetId");
    }

    const result = await toggleReaction({
        filter: { tweet: tweetId },
        userId: req.user?._id,
        reactionType: "dislike",
        createPayload: { tweet: tweetId },
    });

    return res
        .status(200)
        .json(new ApiResponse(200, { isDisliked: result.active }));
});

const getLikedVideos = asyncHandler(async (req, res) => {
    const likedVideosAggegate = await Like.aggregate([
        {
            $match: {
                likedBy: new mongoose.Types.ObjectId(`${req.user?._id}`),
                video: { $exists: true, $ne: null },
                $or: [{ type: "like" }, { type: { $exists: false } }],
            },
        },
        {
            $lookup: {
                from: "videos",
                localField: "video",
                foreignField: "_id",
                as: "likedVideo",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "ownerDetails",
                        },
                    },
                    {
                        $unwind: "$ownerDetails",
                    },
                ],
            },
        },
        {
            $unwind: "$likedVideo",
        },
        {
            $sort: {
                createdAt: -1,
            },
        },
        {
            $project: {
                _id: 0,
                likedVideo: {
                    _id: 1,
                    "videoFile.url": 1,
                    "thumbnail.url": 1,
                    owner: 1,
                    title: 1,
                    description: 1,
                    views: 1,
                    duration: 1,
                    createdAt: 1,
                    isPublished: 1,
                    ownerDetails: {
                        username: 1,
                        fullName: 1,
                        "avatar.url": 1,
                    },
                },
            },
        },
    ]);

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                likedVideosAggegate,
                "liked videos fetched successfully"
            )
        );
});

export {
    toggleVideoLike,
    toggleVideoDislike,
    toggleCommentLike,
    toggleCommentDislike,
    toggleTweetLike,
    toggleTweetDislike,
    getLikedVideos,
};
