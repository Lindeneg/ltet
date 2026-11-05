import {success, type AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {MaybeNull, MaybeUndefined} from "../lib/types.js";
import type {Category, RawStatement} from "../lib/content.js";
import {tally, type ScoredStatement, type Standing, type Tally} from "../lib/score.js";
import {listSeasons, seasonStartYear, type Season} from "../lib/seasons.js";
import {buildSnapshots, type Snapshot} from "../lib/snapshots.js";
import type StatementRepository from "../repositories/statement-repository.js";
import type ContentService from "./content-service.js";

export const RECORD_START = Date.UTC(2022, 10, 30);
export const ALL_TIME_KEY = "all-time";

export type LeagueSeason =
    | (Season & {allTime: false})
    | {key: typeof ALL_TIME_KEY; name: "All-time"; allTime: true; from: number; current: false};

export type Place = {pos: number; tied: boolean};

export type CategoryAward = {category: Category; best: number; winners: Standing[]; margin: MaybeNull<number>};

export type SeasonContext = {
    key: string;
    season: LeagueSeason;
    statements: ScoredStatement[];
    standings: Standing[];
    newest: ScoredStatement[];
    rowById: Map<string, Standing>;
    place: Map<string, Place>;
    topTotal: number;
    champions: Standing[];
    bottomTotal: number;
    foot: Standing[];
    runnerUp: MaybeUndefined<Standing>;
    lead: MaybeNull<number>;
    totalForks: number;
    inProgress: boolean;
    finished: boolean;
    showMovement: boolean;
    movement: Map<string, number>;
    latestDay: MaybeNull<number>;
    snapshots: Snapshot[];
    topForks: number;
    cakes: ScoredStatement[];
    awards: CategoryAward[];
};

export type League = {
    stamp: string;
    now: number;
    record: Tally;
    newest: ScoredStatement[];
    byId: Map<string, ScoredStatement>;
    seasons: LeagueSeason[];
    allTime: LeagueSeason;
    seasonByKey: Map<string, LeagueSeason>;
    defaultKey: string;
    context(key: string): SeasonContext;
};

const newestFirst = (a: ScoredStatement, b: ScoredStatement) => b.time - a.time;
const rankIn = (values: number[], value: number) => 1 + values.filter((v) => v > value).length;
const seasonOf = (st: RawStatement) => seasonStartYear(Date.parse(`${st.date}T00:00:00Z`));
const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

class LeagueService {
    #league: MaybeNull<AsyncResult<League, DbError>> = null;
    #day = "";
    #generation = 0;

    constructor(
        private readonly statementRepo: StatementRepository,
        private readonly content: ContentService,
        private readonly clock: () => number = Date.now
    ) {}

    get(): AsyncResult<League, DbError> {
        const now = this.clock();
        if (utcDay(now) !== this.#day) this.invalidate();
        if (!this.#league) {
            this.#day = utcDay(now);
            const pending = this.#load(now, `${this.#day}:${this.#generation}`);
            this.#league = pending;
            pending.then((result) => {
                if (!result.ok && this.#league === pending) this.#league = null;
            });
        }
        return this.#league;
    }

    invalidate(): void {
        this.#league = null;
        this.#generation++;
    }

    async #load(now: number, stamp: string): AsyncResult<League, DbError> {
        const raw = await this.statementRepo.listPublished();
        if (!raw.ok) return raw;
        return success(this.#build(raw.data, now, stamp));
    }

    #build(raw: RawStatement[], now: number, stamp: string): League {
        const {ceos, rubric} = this.content.get();
        const record = tally(ceos, rubric, raw);
        const seasons: LeagueSeason[] = listSeasons(RECORD_START, now).map((season) => ({
            ...season,
            allTime: false as const,
        }));
        const allTime: LeagueSeason = {
            key: ALL_TIME_KEY,
            name: "All-time",
            allTime: true,
            from: RECORD_START,
            current: false,
        };
        const seasonByKey = new Map([allTime, ...seasons].map((season) => [season.key, season]));
        const contexts = new Map<string, SeasonContext>();

        const context = (key: string): SeasonContext => {
            const known = contexts.get(key);
            if (known) return known;
            const season = seasonByKey.get(key);
            if (!season) throw new Error(`no season ${key}`);
            const built = this.#context(season, raw, now);
            contexts.set(key, built);
            return built;
        };

        return {
            stamp,
            now,
            record,
            newest: [...record.statements].sort(newestFirst),
            byId: new Map(record.statements.map((st) => [st.id, st])),
            seasons,
            allTime,
            seasonByKey,
            defaultKey: ALL_TIME_KEY,
            context,
        };
    }

    #context(season: LeagueSeason, raw: RawStatement[], now: number): SeasonContext {
        const {ceos, rubric} = this.content.get();
        const inSeason = season.allTime ? raw : raw.filter((st) => seasonOf(st) === season.startYear);
        const {statements, standings} = tally(ceos, rubric, inSeason);
        const totals = standings.map((row) => row.total);
        const place = new Map(
            standings.map((row) => [
                row.ceo.id,
                {pos: rankIn(totals, row.total), tied: totals.filter((t) => t === row.total).length > 1},
            ])
        );
        const topTotal = standings[0]?.total ?? 0;
        const champions = topTotal > 0 ? standings.filter((row) => row.total === topTotal) : [];
        const bottomTotal = standings.at(-1)?.total ?? 0;
        const foot =
            standings.length > 1 && topTotal > 0 && bottomTotal !== topTotal
                ? standings.filter((row) => row.total === bottomTotal)
                : [];
        const runnerUp = standings.find((row) => row.total < topTotal);
        const from = season.allTime ? (statements[0]?.time ?? RECORD_START) : season.from;
        const to = season.allTime ? now : Math.min(season.end, now);
        const live = season.allTime || season.current;
        const latestDay = statements.at(-1)?.time ?? null;
        const totalsThen = standings.map((row) =>
            row.own.reduce((sum, st) => (latestDay !== null && st.time < latestDay ? sum + st.forks : sum), 0)
        );
        const topForks = Math.max(0, ...statements.map((st) => st.forks));
        const awards = rubric.categories.map((category) => {
            const scored = standings
                .map((row) => ({row, points: Math.round(row.byCategory[category.id])}))
                .sort((a, b) => b.points - a.points);
            const best = scored[0]?.points ?? 0;
            const winners = best > 0 ? scored.filter((x) => x.points === best).map((x) => x.row) : [];
            const runner = scored.find((x) => x.points < best);
            return {category, best, winners, margin: winners.length === 1 && runner ? best - runner.points : null};
        });

        return {
            key: season.key,
            season,
            statements,
            standings,
            newest: [...statements].sort(newestFirst),
            rowById: new Map(standings.map((row) => [row.ceo.id, row])),
            place,
            topTotal,
            champions,
            bottomTotal,
            foot,
            runnerUp,
            lead: champions.length === 1 && runnerUp ? topTotal - runnerUp.total : null,
            totalForks: statements.reduce((sum, st) => sum + st.forks, 0),
            inProgress: !season.allTime && season.current,
            finished: !season.allTime && !season.current,
            showMovement: live && latestDay !== null && statements[0].time < latestDay,
            movement: new Map(
                standings.map((row, i) => [row.ceo.id, rankIn(totalsThen, totalsThen[i]) - place.get(row.ceo.id)!.pos])
            ),
            latestDay,
            snapshots: buildSnapshots(standings, {from, to}),
            topForks,
            cakes: topForks > 0 ? statements.filter((st) => st.forks === topForks) : [],
            awards,
        };
    }
}

export default LeagueService;
