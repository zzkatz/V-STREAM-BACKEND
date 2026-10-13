import { ApiError } from "../utilities/ApiError.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import { msUntilAllowed } from "../utilities/loginAttemptStore.js";

export const loginBruteForce = asyncHandler(async (req, res, next) => {
    const identifier = (req.body?.email || req.body?.username || "")
        .toLowerCase()
        .trim();
    const waitMs = msUntilAllowed(req.ip, identifier);

    if (waitMs > 0) {
        const waitSeconds = Math.ceil(waitMs / 1000);
        res.setHeader("Retry-After", String(waitSeconds));
        throw new ApiError(
            429,
            `Too many failed login attempts. Try again in ${waitSeconds}s.`
        );
    }

    next();
});
