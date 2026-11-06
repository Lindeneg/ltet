import {success, type AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {MaybeNull} from "../lib/types.js";
import type {ScoredStatement} from "../lib/score.js";
import {seasonPath, type SeasonView} from "../ui/site.js";
import type StatementRepository from "../repositories/statement-repository.js";
import type LeagueService from "./league-service.js";
import type {League} from "./league-service.js";

export type SitemapEntry = {path: string; lastmod: MaybeNull<number>};

const LIST_VIEWS: SeasonView[] = ["table", "results", "race", "honours"];

class SitemapService {
    #stamp = "";
    #entries: SitemapEntry[] = [];

    constructor(
        private readonly leagueService: LeagueService,
        private readonly statementRepo: StatementRepository
    ) {}

    async get(): AsyncResult<SitemapEntry[], DbError> {
        const league = await this.leagueService.get();
        if (!league.ok) return league;
        if (league.data.stamp === this.#stamp) return success(this.#entries);
        const changes = await this.statementRepo.listChanges();
        if (!changes.ok) return changes;
        this.#entries = this.#build(league.data, changes.data);
        this.#stamp = league.data.stamp;
        return success(this.#entries);
    }

    #build(league: League, changes: Map<string, Date>): SitemapEntry[] {
        const changed = (st: ScoredStatement) => changes.get(st.id)?.getTime() ?? null;
        const newest = (statements: ScoredStatement[]) =>
            statements.reduce<MaybeNull<number>>((max, st) => {
                const time = changed(st);
                return time !== null && (max === null || time > max) ? time : max;
            }, null);

        const entries: SitemapEntry[] = [];
        for (const season of [league.allTime, ...league.seasons]) {
            const ctx = league.context(season.key);
            const lastmod = newest(ctx.statements);
            for (const view of LIST_VIEWS) {
                entries.push({path: seasonPath(league.defaultKey, season.key, view), lastmod});
            }
            for (const row of ctx.standings) {
                entries.push({
                    path: seasonPath(league.defaultKey, season.key, "club", encodeURIComponent(row.ceo.id)),
                    lastmod: newest(row.own),
                });
            }
            if (season.key === league.defaultKey) entries.push({path: "/rules", lastmod: null});
        }
        for (const st of league.newest) {
            entries.push({path: `/match/${encodeURIComponent(st.id)}`, lastmod: changed(st)});
        }
        return entries;
    }
}

export default SitemapService;
