import type {ScoredStatement} from "../../lib/score.js";
import {clip, esc, jsonLd, matches} from "../lib.js";
import {SITE_NAME, seasonTitle, type Site} from "../site.js";
import {DESCRIPTION, previewTags} from "./layout.js";
import {matchPath} from "./pieces.js";

const DESCRIPTION_CHARS = 160;
const NOINDEX = "noindex, follow";

type JsonLd = Record<string, unknown>;

export type PageMeta = {
    title: string;
    description: string;
    path: string;
    article?: boolean;
    noindex?: boolean;
    image?: string;
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
        ? previewTags({url, image: `${base}${meta.image}`})
        : `\n  <meta property="og:url" content="${esc(url)}">`;
    const robots = meta.noindex ? `\n  <meta name="robots" content="${NOINDEX}">` : "";
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

export function matchDescription(statement: ScoredStatement): string {
    return clip(`${statement.who.name}: ${statement.headline.text} “${statement.quote}”`, DESCRIPTION_CHARS);
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
