import { isValidObjectId } from "mongoose";
import { Comment } from "../models/comment.model.js";
import { Video } from "../models/video.model.js";
import { ApiError } from "../utilities/ApiError.js";
import { ApiResponse } from "../utilities/ApiResponse.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import mongoose from "mongoose";

const createComment = asyncHandler(async (req, res) => {
    const { content } = req.body;
    const { videoId } = req.params;

    if (!content) {
        throw new ApiError(400, "Comment cannot be empty");
    }

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    const video = await Video.findById(videoId);
    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    const comment = await Comment.create({
        content,
        owner: req.user?._id,
        video: videoId,
    });

    if (!comment) {
        throw new ApiError(500, "Failed to create a comment !, Please retry");
    }

    const createdComment = await Comment.findById(comment._id)
        .populate("owner", "username fullName avatar")
        .lean();

    const responseComment = {
        ...createdComment,
        likesCount: 0,
        dislikesCount: 0,
        isLiked: false,
        isDisliked: false,
        owner: createdComment?.owner
            ? {
                  _id: createdComment.owner._id,
                  username: createdComment.owner.username,
                  fullName: createdComment.owner.fullName,
                  avatar: {
                      url: createdComment.owner.avatar?.url,
                  },
              }
            : null,
    };

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                responseComment,
                "Comment created successfully"
            )
        );
});

const updateComment = asyncHandler(async (req, res) => {
    const { content } = req.body;
    const { commentId } = req.params;

    if (!content) {
        throw new ApiError(400, "Content required");
    }

    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid comment ID");
    }

    const comment = await Comment.findById(commentId);

    if (!comment) {
        throw new ApiError(404, "Comment not found");
    }
    if (comment?.owner.toString() !== req.user?._id.toString()) {
        throw new ApiError(400, "Not Authorised ");
    }

    const newComment = await Comment.findByIdAndUpdate(
        comment?._id,
        {
            $set: {
                content,
            },
        },
        { new: true }
    );

    if (!newComment) {
        throw new ApiError(500, "Error while updating comment, ! Please retry");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, newComment, "Comment updated successfully"));
});

const deleteComment = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid comment id");
    }

    const comment = await Comment.findById(commentId);

    if (!comment) {
        throw new ApiError(404, "Comment not found");
    }

    if (comment.owner.toString() !== req.user?._id.toString()) {
        throw new ApiError(403, "Not authorized");
    }

    const deletedComment = await Comment.findByIdAndDelete(commentId);

    if (!deletedComment) {
        throw new ApiError(500, "Error while deleting ");
    }

    return res
        .status(200)
        .json(
            new ApiResponse(200, { commentId }, "Comment deleted successfully")
        );
});

const getVideoComments = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    const video = await Video.findById(videoId);
    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    const commentsAggregate = Comment.aggregate([
        {
            $match: {
                video: new mongoose.Types.ObjectId(`${videoId}`),
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "owner",
            },
        },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "comment",
                as: "likes",
            },
        },
        {
            $addFields: {
                likeEntries: {
                    $filter: {
                        input: "$likes",
                        as: "like",
                        cond: { $ne: ["$$like.type", "dislike"] },
                    },
                },
                dislikeEntries: {
                    $filter: {
                        input: "$likes",
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
                owner: {
                    $first: "$owner",
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
            $sort: { createdAt: -1 },
        },
        {
            $project: {
                _id: 1,
                content: 1,
                createdAt: 1,
                updatedAt: 1,
                likesCount: 1,
                dislikesCount: 1,
                isLiked: 1,
                isDisliked: 1,
                "owner._id": 1,
                "owner.avatar.url": 1,
                "owner.username": 1,
                "owner.fullName": 1,
            },
        },
    ]);

    const options = {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
    };
    const comments = await Comment.aggregatePaginate(
        commentsAggregate,
        options
    );

    return res
        .status(200)
        .json(new ApiResponse(200, comments, "Comments fetched successfully"));
});

export { createComment, updateComment, deleteComment, getVideoComments };
