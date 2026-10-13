import { Router } from "express";
import {
    uploadImage,
    uploadMedia,
    enforceImageFieldSize,
} from "../middlewares/multer.middleware.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    deleteVideo,
    getAllVideos,
    getVideoById,
    updateVideo,
    publishAVideo,
    togglePublishStatus,
    downloadVideoClip,
} from "../controllers/video.controller.js";

const router = Router();

router
    .route("/")
    .get(getAllVideos)
    .post(
        verifyJWT,
        uploadMedia.fields([
            {
                name: "videoFile",
                maxCount: 1,
            },
            {
                name: "thumbnail",
                maxCount: 1,
            },
        ]),
        enforceImageFieldSize,
        publishAVideo
    );

router
    .route("/v/:videoId")
    .get(verifyJWT, getVideoById)
    .delete(verifyJWT, deleteVideo)
    .patch(
        verifyJWT,
        uploadImage.single("thumbnail"),
        updateVideo
    );

router
    .route("/v/:videoId/clip")
    .post(verifyJWT, downloadVideoClip);

router.route("/toggle/publish/:videoId").patch(verifyJWT, togglePublishStatus);

export default router;
