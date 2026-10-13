import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import { checkEmailExists, isDisposableEmail } from "../utilities/emailValidation.js";
import { ApiError } from "../utilities/ApiError.js";
import { uploadOnCloudinary } from "../utilities/cloudinary.js";
import { ApiResponse } from "../utilities/ApiResponse.js";
import { clear, recordFailure } from "../utilities/loginAttemptStore.js";
import { updateUserAvatar } from "./avatarUpdate.controller.js";
import { updateUserCoverImage } from "./coverImageUpdate.controller.js";

const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });
        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(
            500,
            "Something went wrong while generating refresh and access token"
        );
    }
};

const registerUser = asyncHandler(async (req, res) => {
    const { fullName, email, username, password } = req.body;

    if (
        [fullName, email, username, password].some(
            (field) => field?.trim() === ""
        )
    ) {
        throw new ApiError(400, "All fields are required");
    }

    const isTempEmail = isDisposableEmail(email)
    const isValidEmail = await checkEmailExists(email)

    if (isTempEmail) {
        throw new ApiError(400, "Disposable or temporary email addresses are not allowed");
    }
    if (!isValidEmail) {
        throw new ApiError(400, "Invalid or non-existent email address");
    }

    const existedUser = await User.findOne({
        $or: [{ username }, { email }],
    });

    if (existedUser) {
        throw new ApiError(
            409,
            "An account with this username or email already exists"
        );
    }

    let coverImageLocalPath = null;
    let coverImageUrl = null;
    let coverImageId = null;
    if (
        req.files &&
        req.files?.coverImage &&
        Array.isArray(req.files?.coverImage) &&
        req.files?.coverImage.length > 0
    ) {
        coverImageLocalPath = req.files.coverImage[0].path;
        const coverImage = await uploadOnCloudinary(coverImageLocalPath).catch(
            (error) => {
                console.error(error);
                throw new ApiError(500, "Error uploading cover image");
            }
        );
        if (coverImage) {
            coverImageUrl = coverImage.secure_url;
            coverImageId = coverImage._id;
        }
    }
    const avatarLocalPath = req.files?.avatar?.[0]?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath).catch((error) =>
        console.error(error)
    );

    if (!avatar) {
        throw new ApiError(400, "Avatar file is required");
    }

    const user = await User.create({
        username: username,
        fullName,
        email,
        password,
        avatar: {
            public_id: avatar.public_id,
            url: avatar.secure_url,
        },

        coverImage: {
            public_id: coverImageId || "",
            url: coverImageUrl || "",
        },
    });

    const createdUser = await User.findById(user._id).select(
        "-password  -refreshToken"
    );

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering user");
    }
    return res
        .status(201)
        .json(
            new ApiResponse(200, createdUser, "User registered successfully ")
        );
});

const loginUser = asyncHandler(async (req, res) => {
    const { email, username, password } = req.body;
    const identifier = (email || username || "").toLowerCase().trim();

    if (!(username || email)) {
        throw new ApiError(400, "Username or email is required");
    }

    if (!password || String(password).trim() === "") {
        throw new ApiError(400, "Password is required");
    }

    const user = await User.findOne({
        $or: [{ email }, { username }]
    });

    if (!user) {
        recordFailure(req.ip, identifier);
        throw new ApiError(404, "No account found with that username or email");
    }

    const isPasswordCorrect = await user.isPasswordCorrect(password);

    if (!isPasswordCorrect) {
        recordFailure(req.ip, identifier);
        throw new ApiError(401, "Incorrect password. Please try again");
    }

    clear(req.ip, identifier);

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

    const loggedInUser = await User.findById(user._id).select(" -password -refreshToken");

    /* 
    Note from abhay:
    // Manually setting Set-Cookie headers to include the "Partitioned" attribute.
    // This is necessary because Express's res.cookie() currently doesn't support setting the Partitioned flag.
    // The Partitioned attribute allows third-party cookies to be scoped per top-level site context,
    // which is part of modern browser privacy changes (e.g., Chrome's Privacy Sandbox).
    // Without this, cookies like "accessToken" and "refreshToken" may be rejected in third-party contexts
    // or trigger warnings, especially when SameSite=None is used.
    */

    res.setHeader("Set-Cookie", [
        `accessToken=${accessToken}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/`,
        `refreshToken=${refreshToken}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/`
    ]);

    const options = {
        httpOnly: true,
        secure: true,
        sameSite: "None"
    };

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                {
                    user: loggedInUser
                },
                "User logged in successfully !!!."
            )
        );

});

const logOutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(req.user._id, {
        $unset: { refreshToken: 1 },
    });

    res.setHeader("Set-Cookie", [
        "accessToken=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0",
        "refreshToken=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0",
    ]);

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "User logged out"));
});
/* 
const logOutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: {
                refreshToken: 1,
            },
        },
        {
            new: true,
        }
    );

    const options = {
        httpOnly: true,
        secure: true,
        sameSite: "None"
    };

    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, {}, "User logged out"));
}); */

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken =
        req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorized request");
    }

    try {
        const decodedToken = await jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );

        const user = await User.findById(decodedToken?._id);

        if (!user) {
            throw new ApiError(401, "Invalid refresh token");
        }

        if (incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "Refresh token is expired or use");
        }

        const options = {
            httpOnly: true,
            secure: true,
            sameSite: "None",
        };

        const { accessToken, refreshToken } =
            await generateAccessAndRefreshTokens(user._id);

        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(
                    200,
                    { accessToken, refreshToken },
                    "Access token refreshed "
                )
            );
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid token");
    }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword, confirmPassword } = req.body;

    const user = await User.findById(req.user?._id);

    const isValidPassword = await user.isPasswordCorrect(oldPassword);
    if (!isValidPassword) {
        throw new ApiError(400, "Incorrect old password");
    }

    if (!(newPassword === confirmPassword)) {
        throw new ApiError(
            400,
            "New password and Confirmation password do not match"
        );
    }
    user.password = newPassword;

    await user.save({ validateBeforeSave: false });

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
    return res
        .status(200)
        .json(new ApiResponse(200, req.user, "Current user fetched"));
});

const updateUserDetails = asyncHandler(async (req, res) => {
    const { username, fullName } = req.body;

    if (!(username || fullName)) {
        throw new ApiError(400, "All fields are required");
    }
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullName,
                username,
            },
        },
        { new: true }
    ).select("-password -refreshToken");

    return res
        .status(200)
        .json(
            new ApiResponse(200, user, "Account details updated successfully ")
        );
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
    /*  
    we can get the user profile from the channel url
    the channel url can be found from praramter in req
    */

    const { username } = req.params;

    const channel = await User.aggregate([
        //Stage 1 : match username in all documents ,optionally chained them to lowercase
        {
            $match: {
                username: username?.toLowerCase(),
            },
        },

        //Stage 2 : Doing lookup for subscription from subscription model/schema
        {
            // lookup for all user documents
            // to search for users using _id
            // this will find how many (user)documents contain the channel_name to find the total number of subscribers
            // the subscription filed has user reference in schema
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers",
            },
        },

        // if we searched in documents->channels : then we can find number of subscribers
        // if we search in documents -> users : then we can find how many channels a user has subscribed.

        // Stage 3: this is quite complex but please refer to subscription model
        {
            // Lookup for
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo",
            },
        },
        // Stage 4: Counting the subs and subbed
        // also checking if the user is subbed or not
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers",
                },
                channelsSubscribedToCount: {
                    $size: "$subscribedTo",
                },

                // if found in Stage1 .i.e from total number of subs
                isSubscribed: {
                    $cond: {
                        if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                        then: true,
                        else: false,
                    },
                },
            },
        },

        // Stage 5: forwards or projects 📺 values which are explicitly mentioned.
        {
            $project: {
                fullName: 1,
                username: 1,
                email: 1,
                avatar: 1,
                coverImage: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1
            },
        },
    ]);

    if (!channel?.length) {
        throw new ApiError(404, "Channel does not exist");
    }

    /* we get return value of aggregate as arrays */
    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                channel[0],
                "User channel fetced successfully"
            )
        )
});

const getWatchHistory = asyncHandler(async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(`${req.user._id}`)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        username: 1,
                                        fullName: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ]);

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                user[0].watchHistory,
                "Watch history fetched successfully"
            )
        )
});


export {
    registerUser,
    loginUser,
    logOutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateUserDetails,
    updateUserCoverImage,
    updateUserAvatar,
    getUserChannelProfile,
    getWatchHistory,
};
