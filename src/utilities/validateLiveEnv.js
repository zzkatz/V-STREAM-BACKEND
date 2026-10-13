const REQUIRED_LIVE_ENV = [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "VALKEY_SERVICE_URI",
];

export function assertLiveEnv() {
    const missing = REQUIRED_LIVE_ENV.filter(
        (key) => !process.env[key] || !String(process.env[key]).trim()
    );

    if (missing.length) {
        throw new Error(
            `Missing required live-streaming environment variables: ${missing.join(", ")}`
        );
    }
}

export function isLiveConfigured() {
    return REQUIRED_LIVE_ENV.every(
        (key) => process.env[key] && String(process.env[key]).trim()
    );
}
