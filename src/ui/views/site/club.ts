import type {Category} from "../../../lib/content.js";
import type {Standing} from "../../../lib/score.js";
import {ALL_TIME_KEY, type Place} from "../../../services/league-service.js";
import {SiteLayout} from "../../components/layout.js";
import {face} from "../../components/face.js";
import {FORM_LENGTH, formChips, matchRow, newestFirst, reportList, splitBar} from "../../components/pieces.js";
import {RaceChart} from "../../components/race-chart.js";
import {esc, matches, ordinal, widthClass} from "../../lib.js";
import {seasonShort, seasonTitle, type Site} from "../../site.js";
import {RACE_SCRIPT, contendersOf, monthsText, monthsTop} from "./race.js";
import {posLabel, titleFor, zoneFor} from "./table.js";

const placeName = (p: Place) => `${p.tied ? "joint " : ""}${ordinal(p.pos)}`;

function statRank(site: Site, row: Standing, category: Category): Place {
    const values = site.ctx.standings.map((o) => Math.round(o.byCategory[category.id]));
    const mine = Math.round(row.byCategory[category.id]);
    return {pos: 1 + values.filter((v) => v > mine).length, tied: values.filter((v) => v === mine).length > 1};
}

function neighbour(site: Site, index: number, offset: number, label: string): string {
    const other = site.ctx.standings[index + offset];
    if (!other) return "<span></span>";
    const place = site.ctx.place.get(other.ceo.id)!;
    const before = offset < 0 ? `<span aria-hidden="true">← </span>` : "";
    const after = offset > 0 ? `<span aria-hidden="true"> →</span>` : "";
    return `<a class="club-step" href="${esc(site.href("club", other.ceo.id))}">${before}<span class="sr-only">${esc(`${label}: `)}</span>${esc(`${posLabel(place)} ${other.ceo.shortName}`)}${after}</a>`;
}

function history(site: Site, row: Standing): string {
    const {league, ctx} = site;
    const id = row.ceo.id;
    const line = (key: string, name: string, extra: string) => {
        const c = league.context(key);
        const r = c.rowById.get(id)!;
        return `<tr${key === ctx.key ? ` class="selected"` : ""}><th scope="row"><a href="${esc(site.href("club", id, key))}">${esc(name)}</a>${extra}</th><td class="num">${esc(posLabel(c.place.get(id)!))}</td><td class="num">${r.own.length}</td><td class="num pts">${r.total}</td></tr>`;
    };
    const seasons = league.seasons
        .map((other) => {
            const c = league.context(other.key);
            const soFar = other.current ? `<span class="so-far"> so far</span>` : "";
            const champion =
                c.champions.includes(c.rowById.get(id)!) && !other.current
                    ? `<span class="badge small zone-top">Champion</span>`
                    : "";
            return line(other.key, other.name, soFar + champion);
        })
        .join("");
    return `<table class="history"><caption class="sr-only">${esc(`${row.ceo.name}, season by season`)}</caption><thead><tr><th scope="col">Season</th><th scope="col" class="num">Pos</th><th scope="col" class="num">P</th><th scope="col" class="num">Pts</th></tr></thead><tbody>${seasons}</tbody><tfoot>${line(ALL_TIME_KEY, "All-time", "")}</tfoot></table>`;
}

function statSplit(site: Site, row: Standing, where: string): string {
    const {ctx, categories, rubric} = site;
    const leads = new Set(ctx.awards.filter((a) => a.winners.includes(row)).map((a) => a.category.id));
    const best = Math.max(1, ...ctx.standings.flatMap((o) => categories.map((c) => o.byCategory[c.id])));
    const rows = categories
        .map((c) => {
            const value = Math.round(row.byCategory[c.id]);
            const award = leads.has(c.id) ? `<span class="badge small zone-top">${esc(c.award.name)}</span>` : "";
            return `<li class="c-${esc(c.id)}"><span class="sr-name"><i class="dot" aria-hidden="true"></i>${esc(c.name)}</span><span class="sr-val">${value}</span><span class="sr-bar" aria-hidden="true"><span class="${widthClass(value / best)}"></span></span><span class="sr-rank">${esc(`${placeName(statRank(site, row, c))} ${where}`)}${award}</span></li>`;
        })
        .join("");
    const bar = splitBar(site, row.byCategory, row.total || 1, `${row.ceo.name}'s ${rubric.unit.many} by count`);
    return `${bar}<ul class="stat-rows">${rows}</ul>`;
}

export type ClubViewProps = {site: Site; title: string; id: string};

export function ClubView({site, title, id}: ClubViewProps): string | null {
    const {ctx, rubric} = site;
    const row = ctx.rowById.get(id);
    if (!row) return null;
    const season = ctx.season;
    const p = ctx.place.get(id)!;
    const ordered = [...row.own].sort(newestFirst);
    const badgeText = titleFor(site, row);
    const zone = zoneFor(ctx, row);
    const top = monthsTop(ctx, id);
    const average = row.own.length ? (row.total / row.own.length).toFixed(1) : "0";
    const index = ctx.standings.indexOf(row);
    const where = season.allTime ? "all-time" : `in ${season.name}`;
    const gold = ctx.champions.includes(row);

    const stats = [
        ["Points", `${row.total}`, rubric.unit.many],
        ["Played", `${row.own.length}`, row.own.length === 1 ? "statement" : "statements"],
        ["Per match", average, rubric.unit.many],
        ["Top of the table", `${top.months}`, monthsText(top).replace(/^\d+ /, "")],
    ]
        .map(
            ([label, value, unit]) =>
                `<div><dt>${esc(label)}</dt><dd><span class="big">${esc(value)}</span><span class="unit">${esc(unit)}</span></dd></div>`
        )
        .join("");

    const chart = RaceChart({
        snapshots: ctx.snapshots,
        contenders: contendersOf(ctx),
        activeId: id,
        compact: true,
        hrefFor: (other) => site.href("club", other),
        rankLabel: "Contenders",
        label: `${row.ceo.name}'s running ${rubric.unit.many} at the end of each month, ${seasonShort(season)}, with every contender's for comparison. The arrow keys move through the months.`,
    });
    const seasonCardTitle = season.allTime
        ? "Over the seasons"
        : ctx.inProgress
          ? "Season so far"
          : `Season ${season.name}`;
    const formNote = row.own.length
        ? `Last ${Math.min(FORM_LENGTH, row.own.length)} ${where}, latest on the right.`
        : `No matches ${where}.`;
    const results = ordered.length
        ? `<ol class="rows card"${reportList(ordered)}>${ordered.map((st) => matchRow(site, st)).join("")}</ol>`
        : `<p class="empty card">${esc(`No matches ${where}.`)}</p>`;

    return SiteLayout({
        title,
        site,
        scripts: [RACE_SCRIPT],
        children: `<section class="view" aria-labelledby="club-title">
      <div>
        <nav class="club-nav" aria-label="Contenders"><a class="back" href="${esc(site.href("table"))}"><span aria-hidden="true">← </span>${esc(`League table, ${seasonShort(season)}`)}</a><span class="club-steps">${neighbour(site, index, -1, "Above him")}${neighbour(site, index, 1, "Below him")}</span></nav>
        <header class="${esc(`club-head ${zone}`.trim())}">${face(row.ceo, {size: "xl", gold, eager: true, beside: false})}<div class="club-id"><p class="eyebrow">${esc(`${row.ceo.company} · ${seasonTitle(season)}`)}</p><h1 id="club-title" tabindex="-1">${esc(row.ceo.name)}</h1>${badgeText ? `<span class="badge ${zone}">${esc(badgeText)}</span>` : ""}</div><div class="club-place"><span class="big">${esc(posLabel(p))}</span><span class="small">${esc(`${placeName(p)} ${where}`)}</span></div></header>
        <dl class="club-stats">${stats}</dl>
        <div class="club-grid">
          <div class="club-side">
            <section class="card" aria-labelledby="club-history"><h2 class="card-title" id="club-history">Season by season</h2><p class="card-note">His place and points in every season; pick one to see it.</p>${history(site, row)}</section>
            <section class="card" aria-labelledby="club-split"><h2 class="card-title" id="club-split">Stat split</h2>${statSplit(site, row, where)}</section>
            <section class="card" aria-labelledby="club-form"><h2 class="card-title" id="club-form">Form</h2><p class="card-note">${esc(formNote)}</p>${row.own.length ? formChips(site, row, "large") : ""}</section>
            <section class="card" aria-labelledby="club-season"><h2 class="card-title" id="club-season">${esc(seasonCardTitle)}</h2><p class="card-note">${esc(`His running ${rubric.unit.many} at the end of each month, a dot on every month that added to them; pick another line to visit its page.`)}</p>${chart}</section>
          </div>
          <section class="club-results" aria-labelledby="club-results"><h2 class="section-title" id="club-results">${esc(`Results ${where}, ${matches(row.own.length)}`)}</h2>${results}</section>
        </div>
      </div>
    </section>`,
    });
}
