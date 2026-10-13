import { Router } from "express";
import {
    getLikedVideos,
    toggleCommentLike,
    toggleCommentDislike,
    toggleVideoLike,
    toggleVideoDislike,
    toggleTweetLike,
    toggleTweetDislike,
} from "../controllers/like.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(verifyJWT);

router.route("/toggle/v/:videoId").post(toggleVideoLike);
router.route("/toggle/dislike/v/:videoId").post(toggleVideoDislike);
router.route("/toggle/c/:commentId").post(toggleCommentLike);
router.route("/toggle/dislike/c/:commentId").post(toggleCommentDislike);
router.route("/toggle/t/:tweetId").post(toggleTweetLike);
router.route("/toggle/dislike/t/:tweetId").post(toggleTweetDislike);
router.route("/videos").get(getLikedVideos);

export default router;
