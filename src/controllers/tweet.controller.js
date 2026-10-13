import { isValidObjectId } from "mongoose";
import { Tweet } from "../models/tweet.model.js";
import { ApiError } from "../utilities/ApiError.js";
import { ApiResponse } from "../utilities/ApiResponse.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import mongoose from "mongoose";

const createTweet = asyncHandler(async (req, res) => {
    const { content } = req.body;

    if (!content) {
        throw new ApiError(400, "Content is requried");
    }
    const tweet = await Tweet.create({
        content,
        owner: req.user?._id,
    });

    if (!tweet) {
        throw new ApiError(500, "Failed to create a tweet, Please retry");
    }
    return res
        .status(200)
        .json(new ApiResponse(200, tweet, "Tweet created successfully"));
});

const updateTweet = asyncHandler(async (req, res) => {
    const { content } = req.body;
    const { tweetId } = req.params;
    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweet id ");
    }
    if (!content) {
        throw new ApiError(400, "Content is required");
    }

    const tweet = await Tweet.findById(tweetId);

    if (!tweet) {
        throw new ApiError(404, "Tweet not found");
    }

    if (tweet?.owner.toString() !== req.user?._id.toString()) {
        throw new ApiError(400, "only owner can edit thier tweet");
    }

    const newTweet = await Tweet.findByIdAndUpdate(
        tweetId,
        {
            $set: {
                content,
            },
            owner: req.user?._id,
        },

        { new: true }
    );

    if (!newTweet) {
        throw new ApiError(500, "Failed to update tweet , Please retry");
    }

    return res
        .status(200)

        .json(new ApiResponse(200, newTweet, "Tweet updated successfully"));
});

const deleteTweet = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweet id ");
    }
    const tweet = await Tweet.findById(tweetId);

    if (!tweet) {
        throw new ApiError(404, "Tweet not found");
    }

    if (tweet?.owner.toString() !== req.user?._id.toString()) {
        throw new ApiError(400, "only owner can delete their tweet");
    }

    const deletedTweet = await Tweet.findByIdAndDelete(tweetId);
    if (!deletedTweet) {
        throw new ApiError(500, "Error while deleting comment ! Please retry");
    }
    return res
        .status(200)
        .json(new ApiResponse(200, { tweetId }, "Tweet deleted successfully"));
});

const getUserTweets = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
        throw new ApiError(400, "Invalid userId");
    }

    const tweets = await Tweet.aggregate([
        {
            $match: {
                owner: new mongoose.Types.ObjectId(`${userId}`),
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "ownerDetails",
                pipeline: [
                    {
                        $project: {
                            username: 1,
                            "avatar.url": 1,
                        },
                    },
                ],
            },
        },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "tweet",
                as: "likeDetails",
                pipeline: [
                    {
                        $project: {
                            likedBy: 1,
                            type: 1,
                        },
                    },
                ],
            },
        },
        {
            $addFields: {
                likeEntries: {
                    $filter: {
                        input: "$likeDetails",
                        as: "like",
                        cond: { $ne: ["$$like.type", "dislike"] },
                    },
                },
                dislikeEntries: {
                    $filter: {
                        input: "$likeDetails",
                        as: "like",
                        cond: { $eq: ["$$like.type", "dislike"] },
                    },
                },
            },
        },
        {
            $addFields: {
                likesCount: {
                    $size: "$likeEntries",
                },
                dislikesCount: {
                    $size: "$dislikeEntries",
                },
                ownerDetails: {
                    $first: "$ownerDetails",
                },
                isLiked: {
                    $cond: {
                        if: { $in: [req.user?._id, "$likeEntries.likedBy"] },
                        then: true,
                        else: false,
                    },
                },
                isDisliked: {
                    $cond: {
                        if: { $in: [req.user?._id, "$dislikeEntries.likedBy"] },
                        then: true,
                        else: false,
                    },
                },
            },
        },
        {
            $sort: {
                createdAt: -1,
            },
        },
        {
            $project: {
                content: 1,
                ownerDetails: 1,
                likesCount: 1,
                dislikesCount: 1,
                createdAt: 1,
                isLiked: 1,
                isDisliked: 1,
            },
        },
    ]);

    return res
        .status(200)
        .json(new ApiResponse(200, tweets, "Tweets fetched successfully"));
});

export { createTweet, updateTweet, deleteTweet, getUserTweets };
