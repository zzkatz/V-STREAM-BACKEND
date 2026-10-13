import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    uploadImage,
    uploadLiveRecordingFile,
} from "../middlewares/multer.middleware.js";
import {
    checkpoint,
    createStream,
    endStream,
    getQuota,
    getStream,
    issueToken,
    listMyStreams,
    listStreams,
    listStreamsByUsername,
    updateStream,
    uploadRecording,
    deleteStream,
} from "../controllers/live.controller.js";
import {
    LIVE_CREATE_RATE_LIMIT,
    LIVE_TOKEN_RATE_LIMIT,
} from "../constants.js";

const router = Router();

const createLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: LIVE_CREATE_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many stream create attempts" },
});

const tokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: LIVE_TOKEN_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many token requests" },
});

router.use(verifyJWT);

router.get("/quota", getQuota);
router.get("/streams", listStreams);
router.get("/streams/mine", listMyStreams);
router.get("/streams/by/:username", listStreamsByUsername);
router.post("/streams", createLimiter, createStream);
router.get("/streams/:id", getStream);
router.patch(
    "/streams/:id",
    uploadImage.single("thumbnail"),
    updateStream
);
router.delete("/streams/:id", deleteStream);
router.post("/streams/:id/token", tokenLimiter, issueToken);
router.post("/streams/:id/end", endStream);
router.post("/streams/:id/checkpoint", checkpoint);
router.post(
    "/streams/:id/recording",
    uploadLiveRecordingFile.single("recording"),
    uploadRecording
);

export default router;
