import Router from "express";
import { rateLimit } from "express-rate-limit";
import {
    loginUser,
    registerUser,
    logOutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateUserDetails,
    getUserChannelProfile,
    getWatchHistory,
} from "../controllers/user.controller.js";

import { updateUserAvatar } from "../controllers/avatarUpdate.controller.js";
import { updateUserCoverImage } from "../controllers/coverImageUpdate.controller.js";
import {
    upload,
    uploadImage,
} from "../middlewares/multer.middleware.js";
import { loginBruteForce } from "../middlewares/loginBruteForce.middleware.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many login attempts. Please try again later.",
        error: "Too many login attempts. Please try again later.",
        data: null,
    },
});

router.route("/register").post(
    uploadImage.fields([
        {
            name: "avatar",
            maxCount: 1,
        },
        {
            name: "coverImage",
            maxCount: 1,
        },
    ]),
    registerUser
);

router
    .route("/login")
    .post(loginLimiter, upload.none(), loginBruteForce, loginUser);

router.route("/logout").post(verifyJWT, logOutUser);
router.route("/refresh-token").post(refreshAccessToken);
router
    .route("/change-password")
    .post(upload.none(), verifyJWT, changeCurrentPassword);
router.route("/current-user").get(verifyJWT, getCurrentUser);
router.route("/update-user").patch(upload.none(), verifyJWT, updateUserDetails);

router
    .route("/update-avatar")
    .patch(verifyJWT, uploadImage.single("avatar"), updateUserAvatar);
router
    .route("/update-coverImg")
    .patch(verifyJWT, uploadImage.single("coverImage"), updateUserCoverImage);

router.route("/c/:username").get(verifyJWT, getUserChannelProfile);
router.route("/watch-history").get(verifyJWT, getWatchHistory);

export default router;
