import type {MaybeUndefined} from "../../lib/types.js";
import {ALL_TIME_KEY, type SeasonContext} from "../../services/league-service.js";
import {CLOSE_ICON, SPRITE, icon, type IconName} from "../icons.js";
import {reportList} from "./pieces.js";
import {COMMENT_CHARS, QUOTE_CHARS, honeypot} from "./report.js";
import {attrs, esc, matches} from "../lib.js";
import {seasonDates, seasonPath, seasonTitle, type SeasonView, type Site} from "../site.js";
import {Ticker} from "./ticker.js";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

export const DESCRIPTION =
    "The court gazette of artificial intelligence: the most powerful men in tech, ranked by the pitchforks their own words raised. Every quote real, every score earned.";
const OG_DESCRIPTION = "The most powerful men in tech, ranked by the pitchforks their own words raised.";

const TABS: {view: SeasonView | "rules"; label: string; icon: IconName}[] = [
    {view: "table", label: "Table", icon: "tab-table"},
    {view: "results", label: "Results", icon: "tab-results"},
    {view: "race", label: "Race", icon: "tab-race"},
    {view: "honours", label: "Honours", icon: "tab-honours"},
    {view: "rules", label: "Rules", icon: "tab-rules"},
];

export type Preview = {url: string; image: string; alt: string};

export type SiteLayoutProps = {
    title: string;
    children: string;
    site?: Site;
    preview?: boolean;
    scripts?: string[];
    noindex?: boolean;
};

// filled in per request, so a page cached once serves every origin
export const PREVIEW_SLOT = "<!--preview-->";

export function previewTags({url, image, alt}: Preview): string {
    return `
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="${OG_WIDTH}">
  <meta property="og:image:height" content="${OG_HEIGHT}">
  <meta property="og:image:alt" content="${esc(alt)}">
  <meta name="twitter:image:alt" content="${esc(alt)}">`;
}

export function robotsTag(content: string): string {
    return `\n  <meta name="robots" content="${esc(content)}">`;
}

function siteTags(noindex: boolean): string {
    return `
  <meta name="description" content="${esc(DESCRIPTION)}">${noindex ? robotsTag("noindex") : ""}
  <meta property="og:type" content="website">
  <meta property="og:title" content="Let Them Eat Tokens">
  <meta property="og:description" content="${esc(OG_DESCRIPTION)}">`;
}

function head(title: string, preview: boolean, scripts: string[], noindex: boolean): string {
    const own = scripts.map((src) => `\n  <script src="${esc(src)}" defer></script>`).join("");
    return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>${preview ? PREVIEW_SLOT : siteTags(noindex)}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="/assets/pitchfork.svg" type="image/svg+xml">
  <script src="/theme-boot.js"></script>
  <link rel="preload" href="/fonts/barlow-condensed/barlow-condensed-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/inter/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/widths.css">
  <script src="/site.js" defer></script>
  <script src="/ticker.js" defer></script>
  <script src="/report.js" defer></script>${own}`;
}

function tabHref(site: MaybeUndefined<Site>, view: SeasonView | "rules"): string {
    if (view === "rules") return "/rules";
    return site ? site.href(view) : seasonPath("", "", view);
}

function Topbar(site: MaybeUndefined<Site>): string {
    const ctx = site?.ctx;
    const season = ctx
        ? `<div class="season">
        ${LivePill(ctx)}
        <span class="season-label">${esc(seasonTitle(ctx.season))}</span>
      </div>`
        : "";
    return `<header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="${esc(tabHref(site, "table"))}" aria-label="Let Them Eat Tokens, the league table">
        ${icon("league-crest", "brand-crest")}
        <span class="brand-text">
          <span class="brand-kicker">The Backlash League</span>
          <span class="brand-name">Let Them Eat Tokens</span>
        </span>
      </a>
      ${season}
      ${site && hasSeason(site) ? SeasonMenu(site) : ""}
      <button type="button" id="theme-toggle" class="icon-button theme-toggle">
        ${icon("sun")}
        <span class="theme-text" aria-hidden="true"></span>
      </button>
    </div>
  </header>`;
}

function Tabs(site: MaybeUndefined<Site>): string {
    const view = site?.route.view;
    const links = TABS.map((tab) => {
        const link = attrs({
            href: tabHref(site, tab.view),
            "aria-current": tab.view === view ? "page" : null,
            class: view === "club" && tab.view === "table" ? "parent" : null,
        });
        return `<a${link}>${icon(tab.icon, "tab-icon")}<span class="tab-label">${tab.label}</span></a>`;
    });
    return `<nav class="tabs" aria-label="League">
    <div class="tabs-inner">
      ${links.join("\n      ")}
    </div>
  </nav>`;
}

function seasonLinks(site: Site, className: string): string[] {
    const {league, ctx, route} = site;
    const view = route.view as SeasonView;
    return [league.allTime, ...league.seasons].map((season) => {
        const link = attrs({
            class: `${className}${season.current ? " current" : ""}`,
            href: seasonPath(league.defaultKey, season.key, view, route.id),
            "aria-current": season.key === ctx.key ? "true" : null,
            "aria-label":
                season.key === ALL_TIME_KEY ? "All-time" : `${season.name}${season.current ? ", in progress" : ""}`,
        });
        const dot = season.current ? `<span class="live-dot" aria-hidden="true"></span>` : "";
        return `<a${link}>${dot}${esc(season.name)}</a>`;
    });
}

function SeasonMenu(site: Site): string {
    const {ctx} = site;
    const dot = ctx.season.current ? `<span class="live-dot" aria-hidden="true"></span>` : "";
    return `<details class="season-menu">
        <summary class="season-menu-button">${dot}<span class="season-menu-name" aria-hidden="true">${esc(ctx.season.name)}</span><span class="sr-only">${esc(seasonTitle(ctx.season))}</span>${icon("chevron", "season-menu-chevron")}</summary>
        <nav class="season-menu-list" aria-label="Season">${seasonLinks(site, "season-menu-link").join("")}</nav>
      </details>`;
}

function LivePill({finished}: SeasonContext): string {
    return `<span class="live${finished ? " final" : ""}"><span class="live-dot" aria-hidden="true"></span><span>${finished ? "Final" : "Live"}</span></span>`;
}

function Seasonbar(site: Site): string {
    const {ctx} = site;
    return `<div class="seasonbar">
    <div class="seasonbar-inner">
      <span class="field-label" id="season-pick-label">Season</span>
      <nav class="season-pick" aria-labelledby="season-pick-label">${seasonLinks(site, "season-link").join("")}</nav>
      <p class="season-dates"><span class="season-state">${LivePill(ctx)}</span>${esc(`${seasonDates(ctx)} · ${matches(ctx.statements.length)}`)}</p>
    </div>
  </div>`;
}

function isPage(site: MaybeUndefined<Site>): boolean {
    return site !== undefined && site.route.view !== "error";
}

function hasSeason(site: Site): boolean {
    return ["table", "results", "race", "honours", "club"].includes(site.route.view);
}

function Dialogs(site: Site): string {
    const options = [
        `<option value="">Not sure</option>`,
        ...site.ceos.map((ceo) => `<option value="${esc(ceo.id)}">${esc(ceo.name)}</option>`),
    ].join("");
    const champions = site.ctx.champions.map((row) => row.ceo.id).join(" ");
    return `<dialog id="report" class="report" aria-labelledby="d-report-headline" data-champions="${esc(champions)}" data-club-path="${esc(site.href("club", ""))}"${reportList(site.league.record.statements)}>
    <div class="report-frame">
      <header class="report-bar">
        <span class="report-label">Match report</span>
        <span id="report-position" class="report-position"></span>
        <button type="button" class="icon-button" data-close aria-label="Close match report">
          ${CLOSE_ICON}
        </button>
      </header>
      <div id="report-body" class="report-body"></div>
      <footer class="report-nav">
        <button type="button" class="nav-button" data-prev><span aria-hidden="true">&larr;</span> <span class="nav-text">Previous</span></button>
        <button type="button" class="nav-button copy" data-copy>Copy link</button>
        <button type="button" class="nav-button" data-next><span class="nav-text">Next</span> <span aria-hidden="true">&rarr;</span></button>
      </footer>
    </div>
  </dialog>

  <dialog id="suggest" class="report suggest" aria-labelledby="suggest-title">
    <div class="report-frame">
      <header class="report-bar">
        <span class="report-label">Report a foul</span>
        <button type="button" class="icon-button" data-suggest-close aria-label="Close the report form">
          ${CLOSE_ICON}
        </button>
      </header>
      <div class="report-body suggest-body">
        <h2 id="suggest-title" class="suggest-title">Spotted a foul we missed?</h2>
        <p class="suggest-intro">A contender said something the league should know about? Send us where it was said; the referee does the rest.</p>
        <form id="suggest-form" class="feedback-form" novalidate>
          <div class="field">
            <label class="field-label" for="suggest-url">Where it was said or reported <span class="req">(required)</span></label>
            <input id="suggest-url" name="url" type="url" inputmode="url" maxlength="2000" required placeholder="https://" autocomplete="off">
          </div>
          <div class="field">
            <label class="field-label" for="suggest-ceo">Who said it <span class="opt">(optional)</span></label>
            <select id="suggest-ceo" name="ceo">${options}</select>
          </div>
          <div class="field">
            <label class="field-label" for="suggest-quote">What they said, as you remember it <span class="opt">(optional)</span></label>
            <textarea id="suggest-quote" name="quote" maxlength="${QUOTE_CHARS}" rows="3"></textarea>
            <span class="char-count" data-count-for="suggest-quote" aria-hidden="true"></span>
          </div>
          <div class="field">
            <label class="field-label" for="suggest-note">A note for the referee <span class="opt">(optional)</span></label>
            <textarea id="suggest-note" name="note" maxlength="${COMMENT_CHARS}" rows="2"></textarea>
            <span class="char-count" data-count-for="suggest-note" aria-hidden="true"></span>
          </div>
          ${honeypot("suggest-website")}
          <p class="form-error" id="suggest-error" role="alert"></p>
          <div class="form-actions">
            <button type="submit" class="button" data-send>Send to the referee</button>
            <button type="button" class="button ghost" data-suggest-close>Cancel</button>
          </div>
        </form>
        <div class="suggest-thanks" id="suggest-thanks" hidden>
          <p class="thanks-title" tabindex="-1">Foul reported.</p>
          <p>Thank you. The referee checks it against its source before it goes anywhere near the table.</p>
          <button type="button" class="button" data-suggest-close>Back to the league</button>
        </div>
        <p class="suggest-note">Every quote is checked word for word against its source before anything goes up. We keep only what you type here: no name, no address.</p>
      </div>
    </div>
  </dialog>`;
}

export function SiteLayout({title, children, site, preview, scripts = [], noindex = false}: SiteLayoutProps): string {
    return `<!doctype html>
<html lang="en">
<head>
  ${head(title, preview ?? isPage(site), scripts, noindex)}
</head>
<body>
  ${SPRITE}

  <a class="skip" href="#main" data-skip>Skip to content</a>

  ${site ? Ticker(site.league.newest) : ""}

  ${Topbar(site)}

  ${Tabs(site)}

  ${site && hasSeason(site) ? Seasonbar(site) : ""}

  <main id="main" tabindex="-1">
    ${children}
  </main>

  <footer class="colophon">
    <p class="foul-line">Spotted a foul we missed? <button type="button" class="text-button" data-suggest>Report it to the referee</button></p>
    <p class="donate-line"><a class="text-button" href="https://ko-fi.com/letthemeattokens" target="_blank" rel="noopener">Buy the referee a token</a></p>
    <p>Unlike our title, every quote here was actually said.</p>
  </footer>

  ${site ? Dialogs(site) : ""}
</body>
</html>`;
}
