import type {Standing} from "../../../lib/score.js";
import type {SeasonContext} from "../../../services/league-service.js";
import {SiteLayout} from "../../components/layout.js";
import {face} from "../../components/face.js";
import {
    FORM_LENGTH,
    MILDEST_FIRST,
    abbrev,
    clubLinks,
    formChips,
    moveMark,
    reportLink,
    reportList,
} from "../../components/pieces.js";
import {icon} from "../../icons.js";
import {count, esc, list, matches} from "../../lib.js";
import {seasonShort, seasonTitle, type Site} from "../../site.js";

export const posLabel = (p: {pos: number; tied: boolean}) => `${p.tied ? "=" : ""}${p.pos}`;

export function titleFor(site: Site, row: Standing): string | null {
    const {ctx, rubric} = site;
    if (ctx.champions.includes(row)) return ctx.inProgress ? "Leader so far" : rubric.titles.first;
    if (ctx.foot.includes(row)) return ctx.inProgress ? "Foot so far" : rubric.titles.last;
    return null;
}

export function zoneFor(ctx: SeasonContext, row: Standing): string {
    return ctx.champions.includes(row) ? "zone-top" : ctx.foot.includes(row) ? "zone-foot" : "";
}

function eyebrow(ctx: SeasonContext): string {
    const played = matches(ctx.statements.length);
    if (ctx.season.allTime) return `All-time · after ${played}`;
    return ctx.finished
        ? `${seasonTitle(ctx.season)} · final table, ${played}`
        : `${seasonTitle(ctx.season)} · after ${played}`;
}

function seasonNumbers(site: Site): string {
    const {ctx, rubric} = site;
    const average = ctx.statements.length ? (ctx.totalForks / ctx.statements.length).toFixed(1) : "0";
    const numbers = [
        ["Matches", count(ctx.statements.length)],
        [rubric.unit.many, count(ctx.totalForks)],
        ["Per match", average],
        ["Contenders", String(ctx.standings.length)],
    ];
    return numbers.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("");
}

function titleRace(site: Site): string {
    const {ctx, rubric, plural} = site;
    const season = ctx.season;
    const badge = (zone: string, text: string) => `<span class="badge ${zone}">${esc(text)}</span>`;
    const faces = (rows: Standing[], gold: boolean) =>
        `<span class="tr-faces">${rows.map((row) => face(row.ceo, {size: "xs", gold})).join("")}</span>`;
    const lines: string[] = [];
    if (ctx.champions.length > 0) {
        const names = list(ctx.champions.map((row) => row.ceo.name));
        const clear = ctx.lead !== null ? `, ${ctx.lead} ${plural(ctx.lead)} clear` : "";
        const sole = ctx.champions.length === 1;
        const prefix = ctx.inProgress ? "In progress: " : "";
        const text = ctx.finished
            ? sole
                ? `${names} won ${season.name}${clear}.`
                : `${names} shared ${season.name} on ${ctx.topTotal} ${plural(ctx.topTotal)}.`
            : sole
              ? `${prefix}${names} leads the table${clear}.`
              : `${prefix}${names} share the top on ${ctx.topTotal} ${plural(ctx.topTotal)}.`;
        lines.push(
            `<p class="tr-line zone-top">${badge("zone-top", rubric.titles.first)}${faces(ctx.champions, true)}<span>${esc(text)}</span></p>`
        );
    } else {
        lines.push(
            `<p class="tr-line">${badge("zone-top", rubric.titles.first)}<span>No matches yet this season. Every contender starts level.</span></p>`
        );
    }
    if (ctx.foot.length > 0) {
        const names = list(ctx.foot.map((row) => row.ceo.name));
        const on = `${ctx.bottomTotal} ${plural(ctx.bottomTotal)}`;
        const text = ctx.finished
            ? `${names} finished ${ctx.foot.length === 1 ? "bottom" : "level at the bottom"} on ${on}.`
            : `${names} ${ctx.foot.length === 1 ? "props" : "prop"} up the table on ${on}${ctx.inProgress ? " so far" : ""}.`;
        lines.push(
            `<p class="tr-line zone-foot">${badge("zone-foot", rubric.titles.last)}${faces(ctx.foot, false)}<span>${esc(text)}</span></p>`
        );
    }
    return lines.join("");
}

function standingsTable(site: Site): string {
    const {ctx, rubric, categories, moveWords} = site;
    const head = `<tr><th scope="col" class="col-pos"><abbr title="Position">Pos</abbr></th><th scope="col" class="col-move"><span class="sr-only">${esc(moveWords.header)}</span></th><th scope="col" class="col-club">Contender</th><th scope="col" class="col-num col-p"><abbr title="Played: statements on the record">P</abbr></th>${categories
        .map(
            (c) =>
                `<th scope="col" class="col-num col-cat c-${esc(c.id)}"><abbr title="${esc(c.name)}">${esc(abbrev(c))}</abbr></th>`
        )
        .join(
            ""
        )}<th scope="col" class="col-num col-pts"><abbr title="${esc(`Points: ${rubric.unit.many}`)}">Pts</abbr></th><th scope="col" class="col-num col-avg"><abbr title="${esc(`${rubric.unit.many} per match`)}">Avg</abbr></th><th scope="col" class="col-form">Form</th></tr>`;
    const rows = ctx.standings.map((row) => {
        const p = ctx.place.get(row.ceo.id)!;
        const title = titleFor(site, row);
        const zone = zoneFor(ctx, row);
        const badge = title ? `<span class="badge small ${zone}">${esc(title)}</span>` : "";
        const club = `<a class="club-link" href="${esc(site.href("club", row.ceo.id))}">${face(row.ceo, {gold: ctx.champions.includes(row)})}<span class="club-names"><span class="club-name"><span class="full">${esc(row.ceo.name)}</span><span class="short" aria-hidden="true">${esc(row.ceo.shortName)}</span></span><span class="club-co">${esc(row.ceo.company)}</span>${badge}</span></a>`;
        const cats = categories
            .map(
                (c) =>
                    `<td class="col-num col-cat c-${esc(c.id)}"><i class="dot" aria-hidden="true"></i>${Math.round(row.byCategory[c.id])}</td>`
            )
            .join("");
        const move = ctx.showMovement ? moveMark(site, ctx.movement.get(row.ceo.id)!) : "";
        const average = row.own.length ? (row.total / row.own.length).toFixed(1) : "0";
        return `<tr${zone ? ` class="${zone}"` : ""}><td class="col-pos">${esc(posLabel(p))}</td><td class="col-move">${move}</td><th scope="row" class="col-club">${club}</th><td class="col-num col-p">${row.own.length}</td>${cats}<td class="col-num col-pts">${row.total}</td><td class="col-num col-avg">${average}</td><td class="col-form">${formChips(site, row)}</td></tr>`;
    });
    const caption = `The league table, ${seasonShort(ctx.season)}: ${rubric.unit.many} per contender, with his statements played, his ${rubric.unit.many} on each count and his last ${FORM_LENGTH} statements as form.`;
    return `<table class="league${ctx.showMovement ? "" : " no-move"}" id="league"><caption class="sr-only">${esc(caption)}</caption><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
}

function tableKey(site: Site): string {
    const {ctx, rubric, categories, moveWords} = site;
    const atEnd = ctx.inProgress ? ", at the season's end" : "";
    const zones = [
        `<li><i class="swatch zone-top" aria-hidden="true"></i>${esc(`Top of the table: ${rubric.titles.first}${atEnd}`)}</li>`,
        `<li><i class="swatch zone-foot" aria-hidden="true"></i>${esc(`Foot of the table: ${rubric.titles.last}${atEnd}`)}</li>`,
        `<li><span class="key-text">${esc(`=4: a shared position, on equal ${rubric.unit.many}`)}</span></li>`,
        ctx.showMovement ? `<li><span class="key-move" aria-hidden="true">▲ ▼ •</span>${esc(moveWords.key)}</li>` : "",
    ];
    const columns = [
        `<li><abbr title="Played">P</abbr> Statements played</li>`,
        ...categories.map(
            (c) =>
                `<li class="c-${esc(c.id)}"><i class="dot" aria-hidden="true"></i><abbr title="${esc(c.name)}">${esc(abbrev(c))}</abbr> ${esc(c.name)}</li>`
        ),
        `<li><abbr title="Points">Pts</abbr> ${esc(rubric.unit.many)}</li>`,
        `<li><abbr title="Average">Avg</abbr> ${esc(`${rubric.unit.many} per match`)}</li>`,
    ];
    const form = [
        `<li>${esc(`Form: his last ${FORM_LENGTH} statements, latest on the right, each with its ${rubric.unit.many}. The fill is the crowd's reaction:`)}</li>`,
        ...[...MILDEST_FIRST]
            .reverse()
            .map(
                (strength, i) =>
                    `<li><span class="fc f${MILDEST_FIRST.length - 1 - i} sample" aria-hidden="true">${icon("pitchfork")}</span>${esc(strength)}</li>`
            ),
    ];
    const lists = [zones, columns, form].map((items) => `<ul class="key">${items.join("")}</ul>`).join("");
    return `<summary class="key-toggle">Key</summary><div class="key-lists">${lists}</div>`;
}

function honoursPreview(site: Site): string {
    const {ctx, rubric, plural} = site;
    const soFar = ctx.inProgress ? " so far" : "";
    const tiles: string[] = [];
    if (ctx.cakes.length > 0) {
        const opens = ctx.cakes.length > 1 ? ctx.cakes : ctx.newest;
        const links = ctx.cakes.map((st) => reportLink(st, "text-button", null, esc(st.headline.text))).join("");
        tiles.push(
            `<article class="tile cake"><p class="tile-kicker">${esc(`Goal of the season${soFar}`)}</p><h3 class="tile-title">${esc(rubric.titles.topStatement.name)}</h3><p class="tile-winner">${esc(list(ctx.cakes.map((st) => st.who.name)))}<span class="tile-points">${esc(`${ctx.topForks} ${plural(ctx.topForks)}${ctx.cakes.length > 1 ? " each" : ""}`)}</span></p><div class="tile-links"${reportList(opens)}>${links}</div></article>`
        );
    }
    for (const award of ctx.awards) {
        if (award.winners.length === 0) continue;
        const points = `${award.best} ${plural(award.best)}${award.margin !== null ? `, ${award.margin} clear` : ""}`;
        tiles.push(
            `<article class="tile c-${esc(award.category.id)}"><p class="tile-kicker"><i class="dot" aria-hidden="true"></i>${esc(`${award.category.name}${soFar}`)}</p><h3 class="tile-title">${esc(award.category.award.name)}</h3><p class="tile-winner">${clubLinks(site, award.winners, ctx.key, "xs")}<span class="tile-points">${esc(points)}</span></p></article>`
        );
    }
    if (ctx.foot.length > 0) {
        const points = `${ctx.bottomTotal} ${plural(ctx.bottomTotal)}${ctx.foot.length > 1 ? " each" : ""}`;
        tiles.push(
            `<article class="tile foot"><p class="tile-kicker">${esc(`Foot of the table${soFar}`)}</p><h3 class="tile-title">${esc(rubric.titles.last)}</h3><p class="tile-winner">${clubLinks(site, ctx.foot, ctx.key, "xs")}<span class="tile-points">${esc(points)}</span></p></article>`
        );
    }
    if (tiles.length === 0) tiles.push(`<p class="empty-note">No honours yet: nobody has scored this season.</p>`);
    return tiles.join("");
}

export type TableViewProps = {site: Site; title: string; preview?: boolean};

export function TableView({site, title, preview}: TableViewProps): string {
    const {ctx} = site;
    const previewTitle = ctx.season.allTime ? "Honours" : ctx.inProgress ? "Season honours so far" : "Season honours";
    const modes = ["short", "full", "form"]
        .map(
            (mode, i) =>
                `<button type="button" data-mode="${mode}" aria-pressed="${i === 0}">${mode[0].toUpperCase()}${mode.slice(1)}</button>`
        )
        .join("\n            ");
    return SiteLayout({
        title,
        site,
        preview,
        children: `<section class="view" aria-labelledby="table-title">
      <div class="view-head">
        <div>
          <p class="eyebrow">${esc(eyebrow(ctx))}</p>
          <h1 id="table-title" tabindex="-1">League table</h1>
        </div>
        <dl class="season-numbers">${seasonNumbers(site)}</dl>
      </div>
      <div class="title-race">${titleRace(site)}</div>
      <div class="card table-card">
        <div class="table-tools">
          <h2 class="card-title">Standings</h2>
          <div class="segmented" id="table-mode" role="group" aria-label="Columns to show">
            ${modes}
          </div>
        </div>
        <div class="table-scroll">${standingsTable(site)}</div>
        <details class="table-key">${tableKey(site)}</details>
      </div>
      <div class="section-row">
        <h2 class="section-title">${esc(previewTitle)}</h2>
        <a class="more" href="${esc(site.href("honours"))}">All honours <span aria-hidden="true">&rarr;</span></a>
      </div>
      <div class="tiles">${honoursPreview(site)}</div>
    </section>`,
    });
}
