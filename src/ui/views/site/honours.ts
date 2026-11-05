import type {Category} from "../../../lib/content.js";
import {points, type ScoredStatement, type Standing} from "../../../lib/score.js";
import type {MaybeNull} from "../../../lib/types.js";
import {SiteLayout} from "../../components/layout.js";
import {clubLinks, matchCard, newestFirst, reportLink, reportList} from "../../components/pieces.js";
import {icon} from "../../icons.js";
import {esc, matches} from "../../lib.js";
import {seasonTitle, type Site} from "../../site.js";

export function finestOn(row: Standing, category: Category): MaybeNull<ScoredStatement> {
    return row.own.reduce<MaybeNull<ScoredStatement>>((top, st) => {
        if (!top) return st;
        const a = points(st, category);
        const b = points(top, category);
        return a > b || (a === b && st.forks > top.forks) ? st : top;
    }, null);
}

function honourCards(site: Site): string {
    const {ctx, rubric, plural} = site;
    const season = ctx.season;
    const soFar = ctx.inProgress ? " so far" : "";
    const ofWhat = season.allTime ? "of all" : "of the season";
    const cards: string[] = [];
    if (ctx.champions.length > 0) {
        const kicker = season.allTime
            ? "The title"
            : ctx.inProgress
              ? "The title race, in progress"
              : `Champion ${season.name}`;
        const detail =
            ctx.champions.length === 1
                ? `${ctx.finished ? "Won with " : ""}${ctx.topTotal} ${plural(ctx.topTotal)} from ${matches(ctx.champions[0].own.length)}${ctx.lead !== null ? `, ${ctx.lead} clear of ${ctx.runnerUp!.ceo.name}` : ""}`
                : `${ctx.topTotal} ${plural(ctx.topTotal)} each`;
        const soFarLabel = ctx.inProgress ? `<span class="so-far">Leader so far: </span>` : "";
        cards.push(
            `<article class="honour champion"><div class="honour-icon">${icon("cup")}</div><div><p class="honour-kicker">${esc(kicker)}</p><h2 class="honour-name">${esc(rubric.titles.first)}</h2><p class="honour-for">${esc(`for raising the most ${rubric.unit.many} ${ofWhat}`)}</p><p class="honour-winner">${soFarLabel}${clubLinks(site, ctx.champions, ctx.key, "md", true)}</p><p class="honour-detail">${esc(detail)}</p></div></article>`
        );
    }
    if (ctx.cakes.length > 0) {
        const opens = ctx.cakes.length > 1 ? ctx.cakes : ctx.newest;
        cards.push(
            `<article class="honour cake"><p class="honour-kicker">${esc(`Goal of the season${soFar}`)}</p><h2 class="honour-name">${esc(rubric.titles.topStatement.name)}</h2><p class="honour-for">${esc(rubric.titles.topStatement.for)}</p><ol class="cards compact"${reportList(opens)}>${ctx.cakes.map((st) => matchCard(site, st)).join("")}</ol></article>`
        );
    }
    for (const award of ctx.awards) {
        if (award.winners.length === 0) continue;
        const single = award.winners.length === 1 ? award.winners[0] : null;
        const finest = single ? finestOn(single, award.category) : null;
        const detail = `${award.best} ${plural(award.best)} for ${award.category.name.toLowerCase()}${award.margin !== null ? `, ${award.margin} clear` : award.winners.length > 1 ? " each" : ""}`;
        const best =
            single && finest
                ? `<p class="honour-best"${reportList([...single.own].sort(newestFirst))}><span class="label">Best on the count: </span>${reportLink(finest, "text-button", null, esc(finest.headline.text))}</p>`
                : "";
        cards.push(
            `<article class="honour award c-${esc(award.category.id)}"><p class="honour-kicker"><i class="dot" aria-hidden="true"></i>${esc(`Individual honour · ${award.category.name}${soFar}`)}</p><h2 class="honour-name">${esc(award.category.award.name)}</h2><p class="honour-for">${esc(award.category.award.for)}</p><p class="honour-winner">${clubLinks(site, award.winners, ctx.key, "md")}</p><p class="honour-detail">${esc(detail)}</p>${best}</article>`
        );
    }
    if (ctx.foot.length > 0) {
        const detail = `${ctx.bottomTotal} ${plural(ctx.bottomTotal)} from ${matches(ctx.foot[0].own.length)}${ctx.foot.length > 1 ? " each" : ""}`;
        cards.push(
            `<article class="honour foot"><p class="honour-kicker">${esc(`Foot of the table${soFar}`)}</p><h2 class="honour-name">${esc(rubric.titles.last)}</h2><p class="honour-for">${esc(`for raising the fewest ${rubric.unit.many} ${ofWhat}`)}</p><p class="honour-winner">${clubLinks(site, ctx.foot, ctx.key, "md")}</p><p class="honour-detail">${esc(detail)}</p></article>`
        );
    }
    if (cards.length === 0) cards.push(`<p class="empty-note">No honours yet: nobody has scored this season.</p>`);
    return cards.join("");
}

function roll(site: Site): string {
    const {league, rubric, plural} = site;
    return league.seasons
        .map((season) => {
            const ctx = league.context(season.key);
            const champion =
                ctx.champions.length > 0
                    ? `<span class="roll-names">${clubLinks(site, ctx.champions, season.key, "sm", true)}</span><span class="roll-pts">${esc(`${ctx.topTotal} ${plural(ctx.topTotal)}`)}</span>`
                    : `<span class="roll-none">No matches yet</span>`;
            const opens = ctx.cakes.length > 1 ? ctx.cakes : ctx.newest;
            const cake =
                ctx.cakes.length > 0
                    ? ctx.cakes
                          .map(
                              (st) =>
                                  `<span class="roll-cake-item">${reportLink(st, "text-button", null, esc(st.headline.text))}<span class="roll-pts">${esc(`${st.who.shortName}, ${st.forks}`)}</span></span>`
                          )
                          .join("")
                    : `<span class="roll-none">None yet</span>`;
            const current = season.current;
            return `<li class="roll-row${season.key === site.ctx.key ? " selected" : ""}"><div class="roll-season"><a href="${esc(site.href("honours", undefined, season.key))}">${esc(season.name)}</a><span class="roll-state${current ? " in-play" : ""}">${current ? "In progress" : "Final"}</span></div><div class="roll-champ"><span class="roll-label">${esc(current ? "Leader so far" : rubric.titles.first)}</span>${champion}</div><div class="roll-cake"${ctx.cakes.length > 0 ? reportList(opens) : ""}><span class="roll-label">${esc(`${rubric.titles.topStatement.name}${current ? " so far" : ""}`)}</span>${cake}</div></li>`;
        })
        .join("");
}

export type HonoursViewProps = {site: Site; title: string};

export function HonoursView({site, title}: HonoursViewProps): string {
    const {ctx} = site;
    const season = ctx.season;
    const eyebrow = season.allTime
        ? "Awarded for distinguished service to public disapproval"
        : `${seasonTitle(season)} · ${ctx.inProgress ? "in progress" : "final"}`;
    return SiteLayout({
        title,
        site,
        children: `<section class="view" aria-labelledby="honours-title">
      <div class="view-head">
        <div>
          <p class="eyebrow">${esc(eyebrow)}</p>
          <h1 id="honours-title" tabindex="-1">${season.allTime ? "All-time honours" : "Season honours"}</h1>
        </div>
      </div>
      <div class="honours">${honourCards(site)}</div>
      <section class="roll" aria-labelledby="roll-title">
        <div class="section-row">
          <h2 class="section-title" id="roll-title">Roll of honour</h2>
        </div>
        <p class="roll-note">Every season's champion and its Cake, newest first.</p>
        <ol class="roll-list">${roll(site)}</ol>
      </section>
    </section>`,
    });
}
