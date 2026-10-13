const attempts = new Map();

const makeKey = (ip, identifier) =>
    `${ip || "unknown"}:${(identifier || "").toLowerCase().trim()}`;

const cooldownForAttempts = (count) => {
    if (count <= 2) return 0;
    if (count === 3) return 5 * 1000;
    if (count === 4) return 15 * 1000;
    if (count === 5) return 60 * 1000;
    return 5 * 60 * 1000;
};

export const getState = (ip, identifier) => {
    const key = makeKey(ip, identifier);
    return attempts.get(key) || { attempts: 0, cooldownUntil: 0 };
};

export const msUntilAllowed = (ip, identifier) => {
    const state = getState(ip, identifier);
    return Math.max(0, state.cooldownUntil - Date.now());
};

export const recordFailure = (ip, identifier) => {
    const key = makeKey(ip, identifier);
    const prev = getState(ip, identifier);
    const nextAttempts = prev.attempts + 1;
    const cooldownMs = cooldownForAttempts(nextAttempts);
    const next = {
        attempts: nextAttempts,
        cooldownUntil: cooldownMs > 0 ? Date.now() + cooldownMs : 0,
    };
    attempts.set(key, next);
    return next;
};

export const clear = (ip, identifier) => {
    attempts.delete(makeKey(ip, identifier));
};
