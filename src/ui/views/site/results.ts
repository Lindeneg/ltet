import type {ScoredStatement} from "../../../lib/score.js";
import type {MaybeUndefined} from "../../../lib/types.js";
import {SiteLayout} from "../../components/layout.js";
import {allCrest, face} from "../../components/face.js";
import {categoryLegend, matchCard, reportList} from "../../components/pieces.js";
import {attrs, count, esc, matches, monthFormat} from "../../lib.js";
import {seasonTitle, type Site} from "../../site.js";

export const SORTS = ["newest", "oldest", "pitchforks"] as const;

export type Sort = (typeof SORTS)[number];

const RESULTS_SCRIPT = "/results.js";

const PHONE_PAGE = 20;

export type ResultsFilters = {ceo: MaybeUndefined<string>; count: MaybeUndefined<string>; sort: Sort};

const SORT_LABELS: Record<Sort, string> = {
    newest: "Newest first",
    oldest: "Oldest first",
    pitchforks: "Most pitchforks",
};

const sortings: Record<Sort, (a: ScoredStatement, b: ScoredStatement) => number> = {
    newest: (a, b) => b.time - a.time,
    oldest: (a, b) => a.time - b.time,
    pitchforks: (a, b) => b.forks - a.forks || b.time - a.time,
};

function passes(site: Site, st: ScoredStatement, ceo: MaybeUndefined<string>, cat: MaybeUndefined<string>): boolean {
    return (!ceo || st.ceo === ceo) && (!cat || st.scores[cat].score >= site.strongMin);
}

export function resultsHref(site: Site, filters: ResultsFilters): string {
    const params = new URLSearchParams();
    if (filters.ceo) params.set("ceo", filters.ceo);
    if (filters.count) params.set("count", filters.count);
    if (filters.sort !== "newest") params.set("sort", filters.sort);
    const query = params.toString();
    return `${site.href("results")}${query ? `?${query}` : ""}`;
}

function rail(site: Site, filters: ResultsFilters): string {
    const {ctx} = site;
    const pick = (id: MaybeUndefined<string>, label: string, name: string, badge: string) => {
        const shown = ctx.statements.filter((st) => passes(site, st, id, filters.count)).length;
        const link = attrs({
            class: "pick",
            href: resultsHref(site, {...filters, ceo: id}),
            "aria-current": filters.ceo === id ? "true" : null,
            "aria-label": `${name}, ${matches(shown)}`,
        });
        return `<a${link}>${badge}<span class="pick-name">${esc(label)}</span><span class="k">${shown}</span></a>`;
    };
    return [
        pick(undefined, "Everyone", "Everyone", allCrest()),
        ...ctx.standings.map((row) =>
            pick(row.ceo.id, row.ceo.shortName, row.ceo.name, face(row.ceo, {gold: ctx.champions.includes(row)}))
        ),
    ].join("");
}

function chips(site: Site, filters: ResultsFilters): string {
    const chip = (id: MaybeUndefined<string>, label: string) => {
        const shown = site.ctx.statements.filter((st) => passes(site, st, filters.ceo, id)).length;
        const on = filters.count === id;
        const link = attrs({
            class: `chip${id ? ` c-${id}` : ""}`,
            href: resultsHref(site, {...filters, count: on ? undefined : id}),
            "aria-current": on ? "true" : null,
        });
        const dot = id ? `<i class="dot" aria-hidden="true"></i>` : "";
        return `<a${link}>${dot}<span class="chip-label">${esc(label)}</span><span class="k">${shown}</span></a>`;
    };
    return [chip(undefined, "Any count"), ...site.categories.map((c) => chip(c.id, c.name))].join("");
}

function list(site: Site, filters: ResultsFilters, shown: ScoredStatement[]): string {
    const {ctx} = site;
    if (shown.length === 0) {
        if (ctx.statements.length === 0) {
            return `<div class="empty card"><p>No matches yet this season. The microphones are on.</p></div>`;
        }
        return `<div class="empty card"><p>No matches on these filters. A quiet month, perhaps.</p><a class="button" href="${esc(resultsHref(site, {ceo: undefined, count: undefined, sort: filters.sort}))}">Clear the filters</a></div>`;
    }
    if (filters.sort === "pitchforks") {
        return `<ol class="cards">${shown.map((st, i) => matchCard(site, st, i + 1)).join("")}</ol>`;
    }
    const months = new Map<string, ScoredStatement[]>();
    for (const st of shown) {
        const key = st.date.slice(0, 7);
        months.set(key, [...(months.get(key) ?? []), st]);
    }
    return [...months]
        .map(([key, items]) => {
            const name = monthFormat.format(new Date(`${key}-01T00:00:00Z`));
            return `<section class="month" aria-label="${esc(name)}"><h2 class="month-title">${esc(name)}<span class="month-count">${esc(matches(items.length))}</span></h2><ol class="cards">${items.map((st) => matchCard(site, st)).join("")}</ol></section>`;
        })
        .join("");
}

function choice(site: Site, filters: ResultsFilters): string {
    const ceo = filters.ceo ? site.ctx.standings.find((row) => row.ceo.id === filters.ceo)?.ceo.shortName : undefined;
    const cat = filters.count ? site.categories.find((c) => c.id === filters.count)?.name : undefined;
    return `${ceo ?? "Everyone"} · ${cat ?? "Any count"}`;
}

function more(shown: ScoredStatement[]): string {
    if (shown.length <= PHONE_PAGE) return "";
    return `<div class="more" data-more="${PHONE_PAGE}" hidden>
        <p class="more-count" aria-live="polite"></p>
        <button type="button" class="button">Show more</button>
      </div>`;
}

function sortForm(site: Site, filters: ResultsFilters, countText: string): string {
    const hidden = [
        filters.ceo ? `<input type="hidden" name="ceo" value="${esc(filters.ceo)}">` : "",
        filters.count ? `<input type="hidden" name="count" value="${esc(filters.count)}">` : "",
    ].join("");
    const options = SORTS.map(
        (sort) =>
            `<option value="${sort}"${sort === filters.sort ? " selected" : ""}>${esc(SORT_LABELS[sort])}</option>`
    ).join("\n            ");
    return `<form class="results-bar" method="get" action="${esc(site.href("results"))}">
        <p class="results-count">${esc(countText)}</p>
        ${hidden}
        <label class="sort">
          <span class="field-label">Order</span>
          <select name="sort" data-autosubmit>
            ${options}
          </select>
        </label>
        <button type="submit" class="button small sort-submit">Sort</button>
      </form>`;
}

export type ResultsViewProps = {site: Site; title: string; filters: ResultsFilters};

export function ResultsView({site, title, filters}: ResultsViewProps): string {
    const {ctx, rubric} = site;
    const pool = ctx.statements;
    const shown = pool.filter((st) => passes(site, st, filters.ceo, filters.count)).sort(sortings[filters.sort]);
    const where = ctx.season.allTime ? "on the record" : `in ${ctx.season.name}`;
    const countText =
        shown.length === pool.length
            ? `${matches(shown.length)} ${where}`
            : `${matches(shown.length)} of ${count(pool.length)} ${where}`;
    const legend = categoryLegend(site, `<li>${esc(`Each card's bar splits its ${rubric.unit.many} by count:`)}</li>`);
    return SiteLayout({
        title,
        site,
        children: `<section class="view" aria-labelledby="results-title">
      <div class="view-head">
        <div>
          <p class="eyebrow">${esc(`Contender vs The Public · ${seasonTitle(ctx.season)}`)}</p>
          <h1 id="results-title" tabindex="-1">Results</h1>
        </div>
        <div class="results-side">
          <p class="next-fixture"${ctx.finished ? " hidden" : ""}><span class="nf-label">Next fixture</span> <span class="nf-teams">Contender vs The Public</span> <span class="nf-time">Kick-off: whenever a microphone is near</span></p>
          <p class="foul-cta"><span>Spotted a foul we missed?</span> <button type="button" class="button small" data-suggest>Report a foul</button></p>
        </div>
      </div>
      <details class="filter-fold">
        <summary class="filter-bar card"><span class="filter-bar-label">Filter</span><span class="filter-bar-choice">${esc(choice(site, filters))}</span></summary>
        <div class="filters card">
          <div class="field">
            <span class="field-label" id="filter-ceo-label">Contender</span>
            <div class="rail" role="group" aria-labelledby="filter-ceo-label">${rail(site, filters)}</div>
          </div>
          <div class="field">
            <span class="field-label" id="filter-cat-label">${esc(`Strong on (${site.strongMin}+ of ${rubric.maxPerCategory})`)}</span>
            <div class="chips" role="group" aria-labelledby="filter-cat-label">${chips(site, filters)}</div>
          </div>
        </div>
      </details>
      ${sortForm(site, filters, countText)}
      <div class="results-legend">${legend}</div>
      <div class="results"${reportList(shown)}>${list(site, filters, shown)}</div>
      ${more(shown)}
    </section>`,
        scripts: [RESULTS_SCRIPT],
    });
}
