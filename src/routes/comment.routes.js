import { Router } from "express";
import {
    createComment,
    updateComment,
    deleteComment,
    getVideoComments,
} from "../controllers/comment.controller.js";

import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

router.use(verifyJWT, upload.none());
router.route("/c/:commentId").delete(deleteComment).patch(updateComment);
router.route("/:videoId").get(getVideoComments).post(createComment);

export default router;
