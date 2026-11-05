export const SEASON_START_MONTH = 7;

export type Season = {
    key: string;
    name: string;
    startYear: number;
    end: number;
    from: number;
    current: boolean;
};

function twoDigits(year: number): string {
    return String(((year % 100) + 100) % 100).padStart(2, "0");
}

export function seasonStartYear(time: number): number {
    const date = new Date(time);
    return date.getUTCMonth() >= SEASON_START_MONTH ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

export function seasonName(startYear: number): string {
    return `${twoDigits(startYear)}/${twoDigits(startYear + 1)}`;
}

export function seasonKey(startYear: number): string {
    return `${twoDigits(startYear)}-${twoDigits(startYear + 1)}`;
}

export function seasonBounds(startYear: number): {start: number; end: number} {
    return {
        start: Date.UTC(startYear, SEASON_START_MONTH, 1),
        end: Date.UTC(startYear + 1, SEASON_START_MONTH, 1) - 1,
    };
}

export function listSeasons(recordStart: number, now: number): Season[] {
    const first = seasonStartYear(recordStart);
    const last = seasonStartYear(Math.max(now, recordStart));
    const seasons: Season[] = [];
    for (let year = last; year >= first; year--) {
        const {start, end} = seasonBounds(year);
        seasons.push({
            key: seasonKey(year),
            name: seasonName(year),
            startYear: year,
            end,
            from: Math.max(start, recordStart),
            current: year === last,
        });
    }
    return seasons;
}
