import dotenv from "dotenv";
import connectDB from "./db/databaseConnect.js";
import app from "./app.js";
import { servicePinger } from "./service.pinger.js";
import { assertLiveEnv, isLiveConfigured } from "./utilities/validateLiveEnv.js";
import { getValkey } from "./utilities/valkey.js";
import { recoverStaleSessions } from "./utilities/liveQuota.js";

dotenv.config({
    path: "./.env",
});

if (process.env.LIVE_STREAMING_ENABLED === "true") {
    assertLiveEnv();
}

connectDB()
    .then(async () => {
        if (isLiveConfigured()) {
            try {
                getValkey();
                await recoverStaleSessions();
                console.log("Live streaming: Valkey connected, stale sessions recovered");
            } catch (err) {
                console.error("Live streaming Valkey init warning:", err.message);
                if (process.env.LIVE_STREAMING_ENABLED === "true") {
                    throw err;
                }
            }
        } else {
            console.warn(
                "Live streaming disabled: set LIVEKIT_* and VALKEY_SERVICE_URI (or LIVE_STREAMING_ENABLED=true to fail hard)"
            );
        }

        app.listen(process.env.PORT || 8000, () => {
            console.log(`Server is listening on: ${process.env.PORT}`);
            servicePinger();
        });
    })
    .catch((error) => console.log("MONGODB connection failed!!!: ", error));
