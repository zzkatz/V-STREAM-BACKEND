import { describe, expect, it } from "vitest";
import {
    elapsedSecOnUtcDate,
    splitSecondsByUtcDay,
    utcDateString,
} from "./liveQuotaMath.js";

describe("utcDateString", () => {
    it("formats UTC calendar date", () => {
        expect(utcDateString(new Date("2026-03-15T23:30:00.000Z"))).toBe(
            "2026-03-15"
        );
    });
});

describe("splitSecondsByUtcDay", () => {
    it("keeps same-day segments in one bucket", () => {
        const chunks = splitSecondsByUtcDay(
            new Date("2026-01-01T10:00:00.000Z"),
            new Date("2026-01-01T10:05:00.000Z")
        );
        expect(chunks).toEqual([{ date: "2026-01-01", seconds: 300 }]);
    });

    it("splits across midnight UTC into two daily buckets", () => {
        const chunks = splitSecondsByUtcDay(
            new Date("2026-01-01T23:59:00.000Z"),
            new Date("2026-01-02T00:01:30.000Z")
        );
        expect(chunks).toEqual([
            { date: "2026-01-01", seconds: 60 },
            { date: "2026-01-02", seconds: 90 },
        ]);
    });

    it("returns empty when end is not after start", () => {
        const start = new Date("2026-01-01T00:00:00.000Z");
        expect(splitSecondsByUtcDay(start, start)).toEqual([]);
    });
});

describe("elapsedSecOnUtcDate", () => {
    it("returns same-day elapsed seconds for today", () => {
        const start = new Date("2026-01-01T10:00:00.000Z");
        const end = new Date("2026-01-01T10:05:00.000Z");
        expect(elapsedSecOnUtcDate(start, end, "2026-01-01")).toBe(300);
    });

    it("returns only today's portion when session crosses UTC midnight", () => {
        const start = new Date("2026-01-01T23:59:00.000Z");
        const end = new Date("2026-01-02T00:01:30.000Z");
        expect(elapsedSecOnUtcDate(start, end, "2026-01-02")).toBe(90);
        expect(elapsedSecOnUtcDate(start, end, "2026-01-01")).toBe(60);
    });

    it("returns 0 when the date has no overlap", () => {
        const start = new Date("2026-01-01T10:00:00.000Z");
        const end = new Date("2026-01-01T10:05:00.000Z");
        expect(elapsedSecOnUtcDate(start, end, "2026-01-03")).toBe(0);
    });
});
