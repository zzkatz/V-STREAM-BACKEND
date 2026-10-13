export const DB_NAME = "test";

export const JSON_BODY_LIMIT = "1mb";
export const IMAGE_MAX_BYTES = 1 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 10 * 1024 * 1024;

export const IMAGE_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/svg+xml",
];

export const VIDEO_MIME_TYPES = [
    "video/mp4",
    "video/x-matroska",
    "video/quicktime",
];

export const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".mov"];

export const MIN_CLIP_DURATION_SEC = 1;
export const MAX_CLIP_DURATION_SEC = 120;
export const MAX_CLIP_BYTES = 50 * 1024 * 1024;

export const LIVE_DAILY_QUOTA_SEC = Number(
    process.env.LIVE_DAILY_QUOTA_SEC || 900
);
export const LIVE_MAX_TITLE_LENGTH = 120;
export const LIVE_MAX_DESCRIPTION_LENGTH = 500;
export const LIVE_MAX_CONCURRENT_VIEWERS = Number(
    process.env.LIVE_MAX_CONCURRENT_VIEWERS || 50
);
export const LIVE_TOKEN_MAX_TTL_SEC = 900;
export const LIVE_VIDEO_MAX_WIDTH = 640;
export const LIVE_VIDEO_MAX_HEIGHT = 360;
export const LIVE_CREATE_RATE_LIMIT = 5;
export const LIVE_TOKEN_RATE_LIMIT = 30;
export const LIVE_HOST_GRACE_SEC = Number(
    process.env.LIVE_HOST_GRACE_SEC || 45
);
export const LIVE_RECORDING_MAX_BYTES = Number(
    process.env.LIVE_RECORDING_MAX_BYTES || 80 * 1024 * 1024
);
export const LIVE_RECORDING_MIME_TYPES = [
    "video/webm",
    "video/mp4",
    "video/x-matroska",
    "video/quicktime",
];
export const LIVE_RECORDING_EXTENSIONS = [".webm", ".mp4", ".mkv", ".mov"];
