import { asyncHandler } from "../utilities/asyncHandler.js";
import { ApiError } from "../utilities/ApiError.js";
import { User } from "../models/user.model.js";
import { Like } from "../models/like.model.js";
import { Video } from "../models/video.model.js";
import { Comment } from "../models/comment.model.js";
import {
    uploadOnCloudinary,
    deleteOnCloudinary,
    buildVideoClipUrl,
} from "../utilities/cloudinary.js";
import { ApiResponse } from "../utilities/ApiResponse.js";
import mongoose, { isValidObjectId } from "mongoose";
import axios from "axios";
import sanitize from "sanitize-filename";
import {
    MIN_CLIP_DURATION_SEC,
    MAX_CLIP_DURATION_SEC,
    MAX_CLIP_BYTES,
} from "../constants.js";

const getAllVideos = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, query, sortBy, sortType, userId } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const searchPipeline = [];

    if (query) {
        const escaped = String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        searchPipeline.push({
            $match: {
                $or: [
                    { title: { $regex: escaped, $options: "i" } },
                    { description: { $regex: escaped, $options: "i" } },
                ],
            },
        });
    }

    if (userId) {
        if (!isValidObjectId(userId)) {
            throw new ApiError(400, "Invalid userId");
        }

        searchPipeline.push({
            $match: {
                owner: new mongoose.Types.ObjectId(userId),
            },
        });
    }

    searchPipeline.push({ $match: { isPublished: true } });

    // Sorting
    if (sortBy && sortType) {
        searchPipeline.push({
            $sort: {
                [sortBy]: sortType === "asc" ? 1 : -1,
            },
        });
    } else {
        searchPipeline.push({ $sort: { createdAt: -1 } });
    }

    // Lookup owner details
    searchPipeline.push(
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
            $unwind: "$ownerDetails",
        }
    );


    const countPipeline = [...searchPipeline, { $count: "total" }];

    // Add pagination stages
    searchPipeline.push(
        { $skip: skip },
        { $limit: limitNum }
    );

    // Run both aggregations
    const [videos, countResult] = await Promise.all([
        Video.aggregate(searchPipeline),
        Video.aggregate(countPipeline),
    ]);

    const totalDocs = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalDocs / limitNum);

    return res.status(200).json(
        new ApiResponse(200, {
            videos,
            pagination: {
                totalDocs,
                totalPages,
                currentPage: pageNum,
                limit: limitNum,
            },
        }, "Videos fetched successfully")
    );
});

const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body;

    if ([title, description].some((field) => field?.trim() === "")) {
        throw new ApiError(400, "All fields are required");
    }

    const videoLocalPath = req.files?.videoFile[0].path;
    const thumbnailLocalPath = req.files?.thumbnail[0].path;

    if (!videoLocalPath) {
        throw new ApiError(400, "Video file is required");
    }
    if (!thumbnailLocalPath) {
        throw new ApiError(400, "Thumbnail file is required");
    }
    const videoFile = await uploadOnCloudinary(videoLocalPath);

    if (!videoFile.url) {
        throw new ApiError(400, "Error while uploading video");
    }
    const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);

    if (!thumbnail.url) {
        throw new ApiError(400, "Error while uploading thumbnail");
    }

    const video = await Video.create({
        title,
        description,
        duration: videoFile.duration,
        videoFile: {
            url: videoFile.secure_url,
            public_id: videoFile.public_id,
        },
        thumbnail: {
            url: thumbnail.secure_url,
            public_id: thumbnail.public_id,
        },
        owner: req.user?._id,
        isPublished: false,
    });

    const isVideoUploaded = await Video.findById(video._id);

    if (!isVideoUploaded) {
        throw new ApiError(500, "Error while uploading video");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, video, "Video uploaded successfully"));
});

const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    if (!isValidObjectId(req.user?._id)) {
        throw new ApiError(400, "Invalid userId");
    }
    const video = await Video.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(`${videoId}`),
            },
        },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes",
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "owner",
                pipeline: [
                    {
                        $lookup: {
                            from: "subscriptions",
                            localField: "_id",
                            foreignField: "channel",
                            as: "subscribers",
                        },
                    },
                    {
                        $addFields: {
                            subscribersCount: {
                                $size: "$subscribers",
                            },
                            isSubscribed: {
                                $cond: {
                                    if: {
                                        $in: [
                                            req.user?._id,
                                            "$subscribers.subscriber",
                                        ],
                                    },
                                    then: true,
                                    else: false,
                                },
                            },
                        },
                    },
                    {
                        $project: {
                            username: 1,
                            "avatar.url": 1,
                            subscribersCount: 1,
                            isSubscribed: 1,
                        },
                    },
                ],
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
            $project: {
                "videoFile.url": 1,
                title: 1,
                description: 1,
                views: 1,
                createdAt: 1,
                duration: 1,
                comments: 1,
                owner: 1,
                likesCount: 1,
                dislikesCount: 1,
                isLiked: 1,
                isDisliked: 1,
            },
        },
    ]);

    if (!video) {
        throw new ApiError(500, "failed to fetch video");
    }

    // Increase views if video fetched successfully
    await Video.findByIdAndUpdate(videoId, {
        $inc: {
            views: 1,
        },
    });

    // add this video to user watch history
    await User.findByIdAndUpdate(req.user?._id, {
        $addToSet: {
            watchHistory: videoId,
        },
    });

    return res
        .status(200)
        .json(
            new ApiResponse(200, video[0], "video details fetched successfully")
        );
});

const updateVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body;
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    if (!(title && description)) {
        throw new ApiError(400, "title and description are required");
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "No video found");
    }

    if (video?.owner.toString() !== req.user?._id.toString()) {
        throw new ApiError(
            400,
            "You can't edit this video as you are not the owner"
        );
    }

    //deleting old thumbnail and updating with new one
    const thumbnailToDelete = video.videoFile.public_id;

    const thumbnailLocalPath = req.file?.path;

    if (!thumbnailLocalPath) {
        throw new ApiError(400, "thumbnail is required");
    }

    const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);

    if (!thumbnail) {
        throw new ApiError(400, "thumbnail not found");
    }

    const updatedVideo = await Video.findByIdAndUpdate(
        videoId,
        {
            $set: {
                title,
                description,
                thumbnail: {
                    public_id: thumbnail.public_id,
                    url: thumbnail.secure_url,
                },
            },
        },
        { new: true }
    );

    if (!updatedVideo) {
        throw new ApiError(500, "Failed to update video please try again");
    }

    if (updatedVideo) {
        await deleteOnCloudinary(thumbnailToDelete);
    }

    return res
        .status(200)
        .json(new ApiResponse(200, updatedVideo, "Video updated successfully"));
});

const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "No video found");
    }

    if (video?.owner.toString() !== req.user?._id.toString()) {
        throw new ApiError(
            400,
            "You can't delete this video as you are not the owner"
        );
    }

    const videoDeleted = await Video.findByIdAndDelete(video?._id);

    if (!videoDeleted) {
        throw new ApiError(400, "Failed to delete the video please try again");
    }

    await deleteOnCloudinary(video.thumbnail.public_id); // video model has thumbnail public_id stored in it->check videoModel
    await deleteOnCloudinary(video.videoFile.public_id, "video"); // specify video while deleting video

    // delete video likes
    await Like.deleteMany({
        video: videoId,
    });

    // delete video comments
    await Comment.deleteMany({
        video: videoId,
    });

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Video deleted successfully"));
});

const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(`Invalid video id: ${videoId}`);
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    if (video?.owner.toString() !== req.user?._id.toString()) {
        throw new ApiError(
            403,
            "Access denied , only owner of this video is allowed to modify the video"
        );
    }

    const videoStatusToggle = await Video.findByIdAndUpdate(
        videoId,
        {
            $set: {
                isPublished: !video?.isPublished,
            },
        },
        { new: true }
    );

    if (!videoStatusToggle) {
        throw new ApiError(500, "Failed change the status of the video");
    }

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                { isPublished: togglePublishStatus.isPublished },
                "Changed view status successfully"
            )
        );
});

const downloadVideoClip = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const start = Number(req.body?.start);
    const end = Number(req.body?.end);

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid videoId");
    }

    const video = await Video.findById(videoId).select(
        "videoFile owner isPublished duration title"
    );

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    const isOwner =
        video.owner?.toString() === req.user?._id?.toString();

    if (!video.isPublished && !isOwner) {
        throw new ApiError(403, "You are not allowed to download this video");
    }

    const duration = Number(video.duration) || 0;

    if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < 0
    ) {
        throw new ApiError(400, "Start and end times must be valid numbers");
    }

    if (start >= end) {
        throw new ApiError(400, "Start time must be before end time");
    }

    if (start > duration || end > duration + 0.25) {
        throw new ApiError(400, "Clip times must be within the video duration");
    }

    const clipLength = end - start;

    if (clipLength < MIN_CLIP_DURATION_SEC) {
        throw new ApiError(
            400,
            `Clip must be at least ${MIN_CLIP_DURATION_SEC} second(s)`
        );
    }

    if (clipLength > MAX_CLIP_DURATION_SEC) {
        throw new ApiError(
            400,
            `Clip cannot exceed ${MAX_CLIP_DURATION_SEC} seconds`
        );
    }

    const publicId = video.videoFile?.public_id;
    if (!publicId) {
        throw new ApiError(500, "Video source is unavailable");
    }

    const clipUrl = buildVideoClipUrl(publicId, start, end);
    if (!clipUrl) {
        throw new ApiError(500, "Failed to create clip URL");
    }

    let upstream;
    try {
        upstream = await axios.get(clipUrl, {
            responseType: "stream",
            timeout: 120000,
            validateStatus: (status) => status >= 200 && status < 300,
        });
    } catch {
        throw new ApiError(502, "Failed to fetch video clip");
    }

    const contentLength = Number(upstream.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > MAX_CLIP_BYTES) {
        upstream.data.destroy();
        throw new ApiError(413, "Clip exceeds maximum allowed file size");
    }

    const safeTitle = sanitize(video.title || "clip") || "clip";
    const startLabel = Math.floor(start);
    const endLabel = Math.floor(end);
    const filename = `${safeTitle}-${startLabel}-${endLabel}.mp4`;

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
    );
    if (Number.isFinite(contentLength) && contentLength > 0) {
        res.setHeader("Content-Length", String(contentLength));
    }

    const abortUpstream = () => {
        if (upstream?.data && !upstream.data.destroyed) {
            upstream.data.destroy();
        }
    };

    req.on("close", abortUpstream);
    res.on("close", abortUpstream);

    upstream.data.on("error", () => {
        abortUpstream();
        if (!res.headersSent) {
            res.status(502).end();
        } else {
            res.destroy();
        }
    });

    upstream.data.pipe(res);
});

export {
    getAllVideos,
    getVideoById,
    publishAVideo,
    updateVideo,
    togglePublishStatus,
    deleteVideo,
    downloadVideoClip,
};
