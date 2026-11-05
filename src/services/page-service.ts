import {success, failure, type AsyncResult} from "../lib/result.js";
import {AppError} from "../lib/errors.js";
import {seasonKey, seasonStartYear} from "../lib/seasons.js";
import type {MaybeNull, MaybeUndefined} from "../lib/types.js";
import {makeSite, seasonShort, SITE_NAME, VIEW_TITLES, type Route, type Site} from "../ui/site.js";
import {PREVIEW_SLOT, previewTags} from "../ui/components/layout.js";
import {ResultsView, SORTS, type ResultsFilters, type Sort} from "../ui/views/site/results.js";
import {MatchView} from "../ui/views/site/match.js";
import {TableView} from "../ui/views/site/table.js";
import {RaceView} from "../ui/views/site/race.js";
import {HonoursView} from "../ui/views/site/honours.js";
import {RulesView} from "../ui/views/site/rules.js";
import {ClubView} from "../ui/views/site/club.js";
import {NotFoundView} from "../ui/views/site/not-found.js";
import {ServerErrorView} from "../ui/views/site/server-error.js";
import type PageCacheService from "./page-cache-service.js";
import type LeagueService from "./league-service.js";
import type ContentService from "./content-service.js";
import {ALL_TIME_KEY, type League} from "./league-service.js";

export type SeasonPage = {season: MaybeUndefined<string>};

export type ResultsQuery = {ceo?: string; count?: string; sort?: string};

class PageService {
    #stamp = "";

    constructor(
        private readonly leagueService: LeagueService,
        private readonly content: ContentService,
        private readonly cache: PageCacheService
    ) {}

    async getTable({season}: SeasonPage, base: string): AsyncResult<string, AppError> {
        const front = season === undefined;
        const html = await this.#render(`table:${season ?? ""}`, season, {view: "table"}, (site) =>
            TableView({site, title: this.#title(site, VIEW_TITLES.table), preview: front})
        );
        if (!html.ok || !front) return html;
        return success(html.data.replace(PREVIEW_SLOT, previewTags({url: `${base}/`, image: `${base}/og.png`})));
    }

    getRace({season}: SeasonPage): AsyncResult<string, AppError> {
        return this.#render(`race:${season ?? ""}`, season, {view: "race"}, (site) =>
            RaceView({site, title: this.#title(site, VIEW_TITLES.race)})
        );
    }

    getHonours({season}: SeasonPage): AsyncResult<string, AppError> {
        return this.#render(`honours:${season ?? ""}`, season, {view: "honours"}, (site) =>
            HonoursView({site, title: this.#title(site, VIEW_TITLES.honours)})
        );
    }

    getRules(): AsyncResult<string, AppError> {
        return this.#render("rules", undefined, {view: "rules"}, (site) =>
            RulesView({site, title: this.#title(site, VIEW_TITLES.rules), ceos: this.content.get().ceos})
        );
    }

    getClub({season}: SeasonPage, id: string): AsyncResult<string, AppError> {
        return this.#render(`club:${season ?? ""}:${id}`, season, {view: "club", id}, (site) => {
            const row = site.ctx.rowById.get(id);
            return row ? ClubView({site, title: this.#title(site, row.ceo.name), id}) : null;
        });
    }

    async getResults({season}: SeasonPage, query: ResultsQuery): AsyncResult<string, AppError> {
        const ceo = query.ceo || undefined;
        const count = query.count || undefined;
        const sort = (query.sort || "newest") as Sort;
        if (!SORTS.includes(sort)) return failure(AppError.NOT_FOUND);
        if (count && !this.content.get().rubric.categories.some((c) => c.id === count))
            return failure(AppError.NOT_FOUND);
        if (ceo && !this.content.get().ceos.some((c) => c.id === ceo)) return failure(AppError.NOT_FOUND);
        const filters: ResultsFilters = {ceo, count, sort};
        return this.#render(
            `results:${season ?? ""}:${ceo ?? ""}:${count ?? ""}:${sort}`,
            season,
            {view: "results"},
            (site) => ResultsView({site, title: this.#title(site, VIEW_TITLES.results), filters})
        );
    }

    async getMatch(id: string): AsyncResult<string, AppError> {
        const league = await this.#league();
        if (!league.ok) return league;
        const statement = league.data.byId.get(id);
        if (!statement) return failure(AppError.NOT_FOUND);
        return this.#render(`match:${id}`, seasonKey(seasonStartYear(statement.time)), {view: "match", id}, (site) =>
            MatchView({site, title: `${statement.headline.text} · ${SITE_NAME}`, statement})
        );
    }

    async getNotFound(): Promise<string> {
        const site = await this.#defaultSite();
        return NotFoundView(site);
    }

    async getServerError(): Promise<string> {
        const site = await this.#defaultSite();
        return ServerErrorView(site);
    }

    #title(site: Site, view: string): string {
        const {league, ctx, route} = site;
        if (route.view === "table" && ctx.key === league.defaultKey) return SITE_NAME;
        const suffix = route.view === "rules" ? "" : ` ${seasonShort(ctx.season)}`;
        return `${view}${suffix} · ${SITE_NAME}`;
    }

    async #league(): AsyncResult<League, AppError> {
        const league = await this.leagueService.get();
        if (!league.ok) return league;
        if (league.data.stamp !== this.#stamp) {
            this.cache.clear();
            this.#stamp = league.data.stamp;
        }
        return league;
    }

    async #defaultSite(): Promise<MaybeUndefined<Site>> {
        const league = await this.#league();
        if (!league.ok) return undefined;
        return makeSite(league.data, this.content.get(), undefined, {view: "error"});
    }

    async #render(
        cacheKey: string,
        season: MaybeUndefined<string>,
        route: Route,
        render: (site: Site) => MaybeNull<string>
    ): AsyncResult<string, AppError> {
        const league = await this.#league();
        if (!league.ok) return league;
        if (season === ALL_TIME_KEY) return failure(AppError.NOT_FOUND);
        if (season !== undefined && !league.data.seasonByKey.has(season)) return failure(AppError.NOT_FOUND);

        const cached = this.cache.get(cacheKey);
        if (cached) return success(cached);

        const html = render(makeSite(league.data, this.content.get(), season, route));
        if (html === null) return failure(AppError.NOT_FOUND);
        this.cache.set(cacheKey, html);
        return success(html);
    }
}

export default PageService;
