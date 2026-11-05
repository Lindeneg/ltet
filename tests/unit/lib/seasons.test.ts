import {describe, expect, it} from "vitest";
import {listSeasons, seasonBounds, seasonKey, seasonName, seasonStartYear} from "../../../src/lib/seasons.js";

describe("seasons", () => {
    it("starts a season on 1 August", () => {
        expect(seasonStartYear(Date.UTC(2025, 6, 31, 23, 59, 59, 999))).toBe(2024);
        expect(seasonStartYear(Date.UTC(2025, 7, 1))).toBe(2025);
    });

    it("names a season by its two years", () => {
        expect(seasonName(2025)).toBe("25/26");
        expect(seasonKey(2025)).toBe("25-26");
        expect(seasonName(2099)).toBe("99/00");
    });

    it("bounds a season to the millisecond", () => {
        expect(seasonBounds(2025)).toEqual({start: Date.UTC(2025, 7, 1), end: Date.UTC(2026, 7, 1) - 1});
    });

    it("lists the seasons newest first, the first starting with the record", () => {
        const recordStart = Date.UTC(2022, 10, 30);

        const seasons = listSeasons(recordStart, Date.UTC(2026, 10, 1));

        expect(seasons.map((s) => [s.key, s.current])).toEqual([
            ["26-27", true],
            ["25-26", false],
            ["24-25", false],
            ["23-24", false],
            ["22-23", false],
        ]);
        expect(seasons.at(-1)!.from).toBe(recordStart);
        expect(seasons[0].from).toBe(Date.UTC(2026, 7, 1));
    });
});
