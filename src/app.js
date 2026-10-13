import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import mongoSanitize from "express-mongo-sanitize";
import multer from "multer";
import { JSON_BODY_LIMIT } from "./constants.js";
import { handleLiveWebhook } from "./controllers/live.controller.js";

const app = new express();

app.set("trust proxy", 1);

// LiveKit webhooks need the raw body before JSON parsing
app.post(
    "/api/v1/live/webhook",
    express.raw({ type: ["application/webhook+json", "application/json"] }),
    handleLiveWebhook
);

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "Rate limited",
});
app.use(
    session({
        secret: process.env.SESSION_SECRET || "your-secret-key",
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: process.env.NODE_ENV === "production",
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24,
        },
    })
);

const corsConfig = {
    origin: process.env.CORS_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
};

app.use(limiter);
app.use(cors(corsConfig));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
app.use(express.static("public"));
app.use(cookieParser());
app.use(morgan("dev"));
app.use(
    mongoSanitize({
        replaceWith: "_",
        allowDots: true,
    })
);
import userRouter from "./routes/user.routes.js";
import commentRouter from "./routes/comment.routes.js";
import likeRouter from "./routes/like.routes.js";
import subscriptionRouter from "./routes/subscription.routes.js";
import tweetRouter from "./routes/tweet.routes.js";
import videoRouter from "./routes/video.routes.js";
import healthcheckRouter from "./routes/healthcheck.routes.js";
import playlistRouter from "./routes/playlist.routes.js";
import dashboardRouter from "./routes/dashboard.routes.js";
import liveRouter from "./routes/live.routes.js";

app.use("/api/v1/users", userRouter);
app.use("/api/v1/comment", commentRouter);
app.use("/api/v1/likes", likeRouter);
app.use("/api/v1/subscriptions", subscriptionRouter);
app.use("/api/v1/tweet", tweetRouter);
app.use("/api/v1/video", videoRouter);
app.use("/api/v1/healthcheck", healthcheckRouter);
app.use("/api/v1/playlist", playlistRouter);
app.use("/api/v1/dashboard", dashboardRouter);
app.use("/api/v1/live", liveRouter);

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
                success: false,
                message: "File too large",
                error: "File too large",
                errors: [],
                data: null,
            });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
            return res.status(400).json({
                success: false,
                message: "Unexpected file field",
                error: "Unexpected file field",
                errors: [],
                data: null,
            });
        }
    }

    if (err?.type === "entity.too.large" || err?.status === 413) {
        return res.status(413).json({
            success: false,
            message: "Request body too large",
            error: "Request body too large",
            errors: [],
            data: null,
        });
    }

    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const errors = Array.isArray(err.error) ? err.error : [];

    return res.status(statusCode).json({
        success: false,
        message,
        error: message,
        errors,
        data: null,
    });
});

export default app;
