import {success, failure, type AsyncResult} from "../lib/result.js";
import {AppError} from "../lib/errors.js";
import {seasonKey, seasonStartYear} from "../lib/seasons.js";
import type {MaybeNull, MaybeUndefined} from "../lib/types.js";
import {makeSite, seasonShort, SITE_NAME, VIEW_TITLES, type Route, type Site} from "../ui/site.js";
import {PREVIEW_SLOT} from "../ui/components/layout.js";
import {matchPath} from "../ui/components/pieces.js";
import {
    clubData,
    clubDescription,
    honoursDescription,
    matchData,
    matchDescription,
    matchImageAlt,
    raceDescription,
    resultsDescription,
    rulesDescription,
    seoTags,
    tableDescription,
    tableImageAlt,
    type PageMeta,
} from "../ui/components/seo.js";
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

    getTable({season}: SeasonPage, base: string): AsyncResult<string, AppError> {
        const front = season === undefined;
        return this.#render(
            `table:${season ?? ""}`,
            season,
            {view: "table"},
            (site) => TableView({site, title: this.#title(site, VIEW_TITLES.table)}),
            (site) => ({
                title: this.#title(site, VIEW_TITLES.table),
                description: tableDescription(site),
                path: site.href("table"),
                image: front ? "/og.png" : undefined,
                imageAlt: front ? tableImageAlt(site.plural(0)) : undefined,
            }),
            base
        );
    }

    getRace({season}: SeasonPage, base: string): AsyncResult<string, AppError> {
        return this.#render(
            `race:${season ?? ""}`,
            season,
            {view: "race"},
            (site) => RaceView({site, title: this.#title(site, VIEW_TITLES.race)}),
            (site) => this.#meta(site, VIEW_TITLES.race, site.href("race"), raceDescription(site)),
            base
        );
    }

    getHonours({season}: SeasonPage, base: string): AsyncResult<string, AppError> {
        return this.#render(
            `honours:${season ?? ""}`,
            season,
            {view: "honours"},
            (site) => HonoursView({site, title: this.#title(site, VIEW_TITLES.honours)}),
            (site) => this.#meta(site, VIEW_TITLES.honours, site.href("honours"), honoursDescription(site)),
            base
        );
    }

    getRules(base: string): AsyncResult<string, AppError> {
        return this.#render(
            "rules",
            undefined,
            {view: "rules"},
            (site) => RulesView({site, title: this.#title(site, VIEW_TITLES.rules), ceos: this.content.get().ceos}),
            (site) => this.#meta(site, VIEW_TITLES.rules, "/rules", rulesDescription(site)),
            base
        );
    }

    getClub({season}: SeasonPage, id: string, base: string): AsyncResult<string, AppError> {
        const name = (site: Site) => site.ctx.rowById.get(id)?.ceo.name;
        return this.#render(
            `club:${season ?? ""}:${id}`,
            season,
            {view: "club", id},
            (site) => {
                const ceo = name(site);
                return ceo ? ClubView({site, title: this.#title(site, ceo), id}) : null;
            },
            (site) => ({
                ...this.#meta(site, name(site) ?? "", site.href("club", id), clubDescription(site, id)),
                data: clubData(site, id),
            }),
            base
        );
    }

    async getResults({season}: SeasonPage, query: ResultsQuery, base: string): AsyncResult<string, AppError> {
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
            (site) => ResultsView({site, title: this.#title(site, VIEW_TITLES.results), filters}),
            (site) => ({
                title: this.#title(site, VIEW_TITLES.results),
                description: resultsDescription(site),
                path: site.href("results"),
                robots: ceo || count || sort !== "newest" ? "noindex, follow" : undefined,
            }),
            base
        );
    }

    async getMatch(id: string, base: string): AsyncResult<string, AppError> {
        const league = await this.#league();
        if (!league.ok) return league;
        const statement = league.data.byId.get(id);
        if (!statement) return failure(AppError.NOT_FOUND);
        const title = `${statement.headline.text} · ${SITE_NAME}`;
        return this.#render(
            `match:${id}`,
            seasonKey(seasonStartYear(statement.time)),
            {view: "match", id},
            (site) => MatchView({site, title, statement}),
            (site) => ({
                title,
                description: matchDescription(statement),
                path: matchPath(statement.id),
                article: true,
                image: `/og/${encodeURIComponent(statement.id)}.png`,
                imageAlt: matchImageAlt(statement, site.plural(statement.forks), site.maxForks),
                data: matchData(site, statement),
            }),
            base
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

    #meta(site: Site, view: string, path: string, description: string): PageMeta {
        return {title: this.#title(site, view), description, path};
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
        render: (site: Site) => MaybeNull<string>,
        meta: (site: Site) => PageMeta,
        base: string
    ): AsyncResult<string, AppError> {
        const league = await this.#league();
        if (!league.ok) return league;
        if (season === ALL_TIME_KEY) return failure(AppError.NOT_FOUND);
        if (season !== undefined && !league.data.seasonByKey.has(season)) return failure(AppError.NOT_FOUND);

        const site = makeSite(league.data, this.content.get(), season, route);
        let html = this.cache.get(cacheKey);
        if (!html) {
            const rendered = render(site);
            if (rendered === null) return failure(AppError.NOT_FOUND);
            html = rendered;
            this.cache.set(cacheKey, html);
        }
        const tags = seoTags(meta(site), base);
        return success(html.replace(PREVIEW_SLOT, () => tags));
    }
}

export default PageService;
