import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

 
const uploadOnCloudinary = async (localFilePath) => {
    if (!localFilePath) return null;

    try {
        const result = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",
            moderation: "aws_rek",
        });

        return result;
    } catch (error) {
        console.error("Cloudinary upload failed:", error);
        return null;
    } finally {
        try {
            await fs.promises.unlink(localFilePath);
        } catch (error) {
            if (error.code !== "ENOENT") {
                console.error("Local file cleanup failed:", error);
            }
        }
    }
};

const deleteOnCloudinary = async (public_id, resource_type = "image") => {
    try {
        if (!public_id) return null;


        const result = await cloudinary.uploader.destroy(public_id, {
            resource_type: `${resource_type}`
        });
    } catch (error) {
        return error;

    }
};

const buildVideoClipUrl = (publicId, startSec, endSec) => {
    if (!publicId) return null;

    return cloudinary.url(publicId, {
        resource_type: "video",
        format: "mp4",
        secure: true,
        transformation: [
            {
                start_offset: startSec,
                end_offset: endSec,
            },
        ],
    });
};

const uploadLiveRecording = async (localFilePath) => {
    if (!localFilePath) return null;

    try {
        const result = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "video",
            folder: "vestreams/live-recordings",
            eager: [
                {
                    width: 640,
                    crop: "limit",
                    quality: "auto:eco",
                    fetch_format: "mp4",
                },
            ],
            eager_async: false,
        });

        const compressed = Array.isArray(result.eager) ? result.eager[0] : null;

        return {
            ...result,
            playback_url: compressed?.secure_url || result.secure_url,
            playback_bytes: compressed?.bytes || result.bytes,
            playback_duration: result.duration,
        };
    } catch (error) {
        console.error("Live recording Cloudinary upload failed:", error);
        return null;
    } finally {
        try {
            await fs.promises.unlink(localFilePath);
        } catch (error) {
            if (error.code !== "ENOENT") {
                console.error("Local recording cleanup failed:", error);
            }
        }
    }
};

export {
    uploadOnCloudinary,
    deleteOnCloudinary,
    buildVideoClipUrl,
    uploadLiveRecording,
};