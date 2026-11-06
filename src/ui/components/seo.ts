import type {ScoredStatement} from "../../lib/score.js";
import {clip, count, esc, jsonLd, matches} from "../lib.js";
import {SITE_NAME, seasonTitle, type Site} from "../site.js";
import {DESCRIPTION, previewTags, robotsTag} from "./layout.js";
import {matchPath} from "./pieces.js";
import {placeName} from "../views/site/club.js";

const DESCRIPTION_CHARS = 160;

type JsonLd = Record<string, unknown>;

export type PageMeta = {
    title: string;
    description: string;
    path: string;
    article?: boolean;
    robots?: string;
    image?: string;
    imageAlt?: string;
    data?: (base: string) => JsonLd[];
};

function organization(base: string): JsonLd {
    return {"@type": "Organization", name: SITE_NAME, url: `${base}/`};
}

function website(base: string): JsonLd {
    return {"@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${base}/`};
}

export function seoTags(meta: PageMeta, base: string): string {
    const url = `${base}${meta.path}`;
    const own = meta.image
        ? previewTags({url, image: `${base}${meta.image}`, alt: meta.imageAlt ?? ""})
        : `\n  <meta property="og:url" content="${esc(url)}">`;
    const robots = meta.robots ? robotsTag(meta.robots) : "";
    const data = [website(base), ...(meta.data?.(base) ?? [])].map((item) => `\n  ${jsonLd(item)}`).join("");
    return `
  <meta name="description" content="${esc(meta.description)}">${robots}
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="${meta.article ? "article" : "website"}">
  <meta property="og:site_name" content="${esc(SITE_NAME)}">
  <meta property="og:title" content="${esc(meta.title)}">
  <meta property="og:description" content="${esc(meta.description)}">${own}
  <meta name="twitter:title" content="${esc(meta.title)}">
  <meta name="twitter:description" content="${esc(meta.description)}">${data}`;
}

export function tableDescription(site: Site): string {
    const {ctx} = site;
    if (ctx.season.allTime) return DESCRIPTION;
    const played = ctx.finished
        ? `final table after ${matches(ctx.statements.length)}`
        : `after ${matches(ctx.statements.length)}`;
    return `${seasonTitle(ctx.season)} league table, ${played}: the most powerful men in tech, ranked by the pitchforks their own words raised.`;
}

export function resultsDescription(site: Site): string {
    const {ctx} = site;
    const where = ctx.season.allTime ? "on the record" : `in ${seasonTitle(ctx.season)}`;
    return `Every result ${where}: what the contender said, word for word, the backlash it raised and the pitchforks it scored, with its sources.`;
}

function where(site: Site): string {
    return site.ctx.season.allTime ? "on the record" : `in ${seasonTitle(site.ctx.season)}`;
}

export function raceDescription(site: Site): string {
    return `The race ${where(site)}: month by month, how the most powerful men in tech climbed the table on the ${site.rubric.unit.many} their own words raised.`;
}

export function honoursDescription(site: Site): string {
    const {rubric} = site;
    const which = site.ctx.season.allTime ? "All-time honours" : `${seasonTitle(site.ctx.season)} honours`;
    return `${which}: ${rubric.titles.first}, ${rubric.titles.last}, ${rubric.titles.topStatement.name}, the award for every count and the roll of honour.`;
}

export function rulesDescription(site: Site): string {
    return `The laws of the game: how a statement is scored in ${site.rubric.unit.many}, how the table and the seasons work, who is eligible, the honours and the photo credits.`;
}

export function clubDescription(site: Site, id: string): string {
    const {ctx, rubric} = site;
    const row = ctx.rowById.get(id)!;
    const who = `${row.ceo.name} (${row.ceo.company})`;
    const scope = ctx.season.allTime ? "all-time" : `in ${seasonTitle(ctx.season)}`;
    const record = row.own.length
        ? `${placeName(ctx.place.get(id)!)} ${scope} with ${count(row.total)} ${row.total === 1 ? rubric.unit.one : rubric.unit.many} from ${matches(row.own.length)}`
        : `no matches ${scope}`;
    return clip(
        `${who}: ${record}. Every statement word for word, with the backlash it raised and its sources.`,
        DESCRIPTION_CHARS
    );
}

export function clubData(site: Site, id: string): (base: string) => JsonLd[] {
    const {ceo} = site.ctx.rowById.get(id)!;
    const path = site.href("club", id);
    return (base) => [
        {
            "@context": "https://schema.org",
            "@type": "WebPage",
            url: `${base}${path}`,
            mainEntity: {
                "@type": "Person",
                name: ceo.name,
                worksFor: {"@type": "Organization", name: ceo.company},
                ...(ceo.photo?.file ? {image: `${base}/${ceo.photo.file.replace(/^\/+/, "")}`} : {}),
            },
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
                {"@type": "ListItem", position: 1, name: "Table", item: `${base}${site.href("table")}`},
                {"@type": "ListItem", position: 2, name: ceo.name},
            ],
        },
    ];
}

export function matchDescription(statement: ScoredStatement): string {
    return clip(`${statement.who.name}: ${statement.headline.text} “${statement.quote}”`, DESCRIPTION_CHARS);
}

export function tableImageAlt(unit: string): string {
    return `The all-time league table, every contender ranked by ${unit}`;
}

export function matchImageAlt(statement: ScoredStatement, unit: string, maxForks: number): string {
    return `${statement.who.name}: “${statement.headline.text}”, ${statement.forks} ${unit} of ${maxForks}`;
}

export function matchData(site: Site, statement: ScoredStatement): (base: string) => JsonLd[] {
    const person = {"@type": "Person", name: statement.who.name};
    const club = site.href("club", statement.ceo, site.league.defaultKey);
    return (base) => [
        {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: statement.headline.text,
            description: matchDescription(statement),
            datePublished: statement.date,
            dateModified: statement.date,
            image: [`${base}/og/${encodeURIComponent(statement.id)}.png`],
            mainEntityOfPage: `${base}${matchPath(statement.id)}`,
            author: organization(base),
            publisher: organization(base),
            about: person,
            hasPart: {"@type": "Quotation", text: statement.quote, spokenByCharacter: person},
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
                {
                    "@type": "ListItem",
                    position: 1,
                    name: "Table",
                    item: `${base}${site.href("table", undefined, site.league.defaultKey)}`,
                },
                {"@type": "ListItem", position: 2, name: statement.who.name, item: `${base}${club}`},
                {"@type": "ListItem", position: 3, name: statement.headline.text},
            ],
        },
    ];
}
