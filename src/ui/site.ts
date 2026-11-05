import type {Category, Ceo, Content, Rubric} from "../lib/content.js";
import {maxPitchforks} from "../lib/score.js";
import type {MaybeUndefined} from "../lib/types.js";
import {RECORD_START, type League, type LeagueSeason, type SeasonContext} from "../services/league-service.js";
import {dayFormat, dayThisYear} from "./lib.js";

export const SITE_NAME = "Let Them Eat Tokens";

const STRONG_SHARE = 0.5;

export type SeasonView = "table" | "results" | "race" | "honours" | "club";

export type View = SeasonView | "rules" | "match" | "error";

export const VIEW_TITLES: Record<Exclude<SeasonView, "club">, string> & {rules: string} = {
    table: "League table",
    results: "Results",
    race: "The race",
    honours: "Honours",
    rules: "Laws of the game",
};

export type Route = {view: View; id?: string};

export type MoveWords = {
    mark(move: number): string;
    key: string;
    header: string;
};

export function moveWords(day: number, now: number): MoveWords {
    const on = `on ${dayThisYear(day, now)}`;
    return {
        mark: (move) => (move > 0 ? `Up ${move} ${on}` : move < 0 ? `Down ${-move} ${on}` : `No change ${on}`),
        key: `Places moved with the latest results, ${on}`,
        header: `Movement with the latest results, ${on}`,
    };
}

export type Site = {
    league: League;
    ctx: SeasonContext;
    route: Route;
    rubric: Rubric;
    ceos: Ceo[];
    categories: Category[];
    maxForks: number;
    strongMin: number;
    moveWords: MoveWords;
    href(view: SeasonView, id?: string, season?: string): string;
    plural(n: number): string;
    isChampion(ceoId: string): boolean;
};

export function seasonTitle(season: LeagueSeason): string {
    return season.allTime ? "All-time" : `Season ${season.name}`;
}

export function seasonShort(season: LeagueSeason): string {
    return season.allTime ? "all-time" : season.name;
}

export function seasonPath(defaultKey: string, season: string, view: SeasonView, id?: string): string {
    const tail = view === "club" ? `club/${id}` : view === "table" ? "" : view;
    if (season === defaultKey) return `/${tail}`;
    return `/${season}${tail ? `/${tail}` : ""}`;
}

export const recordStartText = `${dayFormat.format(new Date(RECORD_START))}, the day ChatGPT launched`;

export function seasonDates(ctx: SeasonContext): string {
    const season = ctx.season;
    if (season.allTime) return `Every season since ${recordStartText}`;
    const opens = season.from === RECORD_START;
    const start = opens ? recordStartText : dayFormat.format(new Date(season.from));
    return `${start}${opens ? "," : ""} to ${dayFormat.format(new Date(season.end))}${season.current ? ", in progress" : ""}`;
}

export function makeSite(league: League, content: Content, seasonKey: MaybeUndefined<string>, route: Route): Site {
    const ctx = league.context(seasonKey ?? league.defaultKey);
    const {rubric} = content;
    return {
        league,
        ctx,
        route,
        rubric,
        ceos: content.ceos,
        categories: rubric.categories,
        maxForks: maxPitchforks(rubric),
        strongMin: Math.ceil(rubric.maxPerCategory * STRONG_SHARE),
        moveWords: moveWords(ctx.latestDay ?? league.now, league.now),
        href: (view, id, season = ctx.key) => seasonPath(league.defaultKey, season, view, id),
        plural: (n) => (n === 1 ? rubric.unit.one : rubric.unit.many),
        isChampion: (ceoId) => ctx.champions.some((row) => row.ceo.id === ceoId),
    };
}
