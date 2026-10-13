import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    IMAGE_MAX_BYTES,
    IMAGE_MIME_TYPES,
    LIVE_RECORDING_EXTENSIONS,
    LIVE_RECORDING_MAX_BYTES,
    LIVE_RECORDING_MIME_TYPES,
    VIDEO_EXTENSIONS,
    VIDEO_MAX_BYTES,
    VIDEO_MIME_TYPES,
} from "../constants.js";
import { ApiError } from "../utilities/ApiError.js";

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.resolve("public/temp"));
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, `${randomUUID()}${ext}`);
    },
});

const imageFieldNames = new Set(["avatar", "coverImage", "thumbnail"]);

const isAllowedVideo = (file) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mimeOk = VIDEO_MIME_TYPES.includes(file.mimetype);
    const extOk = VIDEO_EXTENSIONS.includes(ext);
    return mimeOk || extOk;
};

const imageFileFilter = (req, file, cb) => {
    if (IMAGE_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
        return;
    }
    cb(
        new ApiError(400, "Only JPEG, PNG, WebP, and SVG images are allowed"),
        false
    );
};

const mediaFileFilter = (req, file, cb) => {
    if (file.fieldname === "videoFile") {
        if (isAllowedVideo(file)) {
            cb(null, true);
            return;
        }
        cb(
            new ApiError(400, "Only MP4, MKV, and MOV videos are allowed"),
            false
        );
        return;
    }

    if (imageFieldNames.has(file.fieldname)) {
        if (IMAGE_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(
            new ApiError(400, "Only JPEG, PNG, WebP, and SVG images are allowed"),
            false
        );
        return;
    }

    cb(new ApiError(400, "Unexpected file field"), false);
};

export const upload = multer({ storage });

export const uploadImage = multer({
    storage,
    limits: { fileSize: IMAGE_MAX_BYTES },
    fileFilter: imageFileFilter,
});

export const uploadMedia = multer({
    storage,
    limits: { fileSize: VIDEO_MAX_BYTES },
    fileFilter: mediaFileFilter,
});

const liveRecordingFileFilter = (req, file, cb) => {
    if (file.fieldname !== "recording") {
        cb(new ApiError(400, "Unexpected file field"), false);
        return;
    }
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mimeOk = LIVE_RECORDING_MIME_TYPES.includes(file.mimetype);
    const extOk = LIVE_RECORDING_EXTENSIONS.includes(ext);
    if (mimeOk || extOk) {
        cb(null, true);
        return;
    }
    cb(
        new ApiError(400, "Only WebM, MP4, MKV, and MOV recordings are allowed"),
        false
    );
};

export const uploadLiveRecordingFile = multer({
    storage,
    limits: { fileSize: LIVE_RECORDING_MAX_BYTES },
    fileFilter: liveRecordingFileFilter,
});

export const enforceImageFieldSize = (req, res, next) => {
    const files = [];

    if (req.file) {
        files.push(req.file);
    }

    if (req.files) {
        if (Array.isArray(req.files)) {
            files.push(...req.files);
        } else {
            Object.values(req.files).forEach((group) => {
                if (Array.isArray(group)) files.push(...group);
            });
        }
    }

    for (const file of files) {
        if (imageFieldNames.has(file.fieldname) && file.size > IMAGE_MAX_BYTES) {
            return next(
                new ApiError(413, "Image file too large. Maximum size is 1MB.")
            );
        }
    }

    next();
};
