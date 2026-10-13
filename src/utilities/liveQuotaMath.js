export function utcDateString(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

export function secondsUntilUtcMidnight(from = new Date()) {
    const next = new Date(
        Date.UTC(
            from.getUTCFullYear(),
            from.getUTCMonth(),
            from.getUTCDate() + 1,
            0,
            0,
            0,
            0
        )
    );
    return Math.max(1, Math.floor((next - from) / 1000));
}

/** Split [start, end] into UTC day buckets. */
export function splitSecondsByUtcDay(start, end) {
    const chunks = [];
    let cursor = new Date(start);
    const endDate = new Date(end);

    if (!(cursor < endDate)) return chunks;

    while (cursor < endDate) {
        const day = utcDateString(cursor);
        const dayEnd = new Date(
            Date.UTC(
                cursor.getUTCFullYear(),
                cursor.getUTCMonth(),
                cursor.getUTCDate() + 1,
                0,
                0,
                0,
                0
            )
        );
        const segmentEnd = dayEnd < endDate ? dayEnd : endDate;
        const seconds = Math.max(
            0,
            Math.floor((segmentEnd - cursor) / 1000)
        );
        if (seconds > 0) {
            chunks.push({ date: day, seconds });
        }
        cursor = segmentEnd;
    }

    return chunks;
}

/** Seconds of [start, end] that fall on the given UTC calendar day. */
export function elapsedSecOnUtcDate(start, end, date = utcDateString(end)) {
    const chunks = splitSecondsByUtcDay(start, end);
    return chunks.find((c) => c.date === date)?.seconds || 0;
}
