import type {SeasonContext} from "../../../services/league-service.js";
import {SiteLayout} from "../../components/layout.js";
import {face} from "../../components/face.js";
import {RaceChart} from "../../components/race-chart.js";
import {esc, monthFormat, widthClass} from "../../lib.js";
import {recordStartText, seasonDates, seasonShort, seasonTitle, type Site} from "../../site.js";

export const RACE_SCRIPT = "/race-chart.js";

export function monthsTop(ctx: SeasonContext, id: string): {months: number; shared: number} {
    const top = ctx.snapshots.filter((snap) => snap.byId.get(id)?.pos === 1);
    return {months: top.length, shared: top.filter((snap) => snap.byId.get(id)!.tied).length};
}

export function monthsText({months, shared}: {months: number; shared: number}): string {
    return `${months} ${months === 1 ? "month" : "months"}${shared ? `, ${shared} shared` : ""}`;
}

export function contendersOf(ctx: SeasonContext) {
    return ctx.standings.map((row) => ({id: row.ceo.id, shortName: row.ceo.shortName}));
}

function raceNote(site: Site): string {
    const {ctx, rubric} = site;
    const season = ctx.season;
    const lines = `Each line is a contender's running ${rubric.unit.many}${season.allTime ? "" : " in the season"} at the end of each month, rising from his first ${rubric.unit.one}; a jump is what that month added. The dots on the followed line mark his months that added to it.`;
    const first = ctx.snapshots[0] ? monthFormat.format(new Date(ctx.snapshots[0].time)) : "later";
    const opening = season.allTime
        ? `The record opened on ${recordStartText}; its first statement is from ${first}.`
        : `${seasonTitle(season)} runs from ${seasonDates(ctx)}.`;
    return `${opening} ${lines}${ctx.statements.length === 0 ? " No matches yet this season." : ""}`;
}

function topMonths(site: Site): string {
    const {ctx} = site;
    const top = ctx.standings
        .map((row) => ({row, ...monthsTop(ctx, row.ceo.id)}))
        .filter((x) => x.months > 0)
        .sort((a, b) => b.months - a.months || a.row.ceo.name.localeCompare(b.row.ceo.name));
    if (top.length === 0) return `<li class="empty-row">Nobody has topped the table yet this season.</li>`;
    const most = Math.max(1, ...top.map((x) => x.months));
    return top
        .map(
            (x) =>
                `<li>${face(x.row.ceo, {gold: site.isChampion(x.row.ceo.id)})}<a href="${esc(site.href("club", x.row.ceo.id))}" class="tm-name">${esc(x.row.ceo.name)}</a><span class="tm-bar" aria-hidden="true"><span class="${widthClass(x.months / most)}"></span></span><span class="tm-num">${esc(monthsText(x))}</span></li>`
        )
        .join("");
}

export type RaceViewProps = {site: Site; title: string};

export function RaceView({site, title}: RaceViewProps): string {
    const {ctx, rubric} = site;
    const season = ctx.season;
    const leaderId = ctx.standings[0]?.ceo.id ?? "";
    const n = ctx.snapshots.length;
    const chips = ctx.standings
        .map(
            (row) =>
                `<button type="button" class="chip" data-follow="${esc(row.ceo.id)}" aria-pressed="${row.ceo.id === leaderId}">${esc(row.ceo.shortName)}</button>`
        )
        .join("");
    const chart = RaceChart({
        snapshots: ctx.snapshots,
        contenders: contendersOf(ctx),
        activeId: leaderId,
        rankLabel: "Follow",
        label: `Running ${rubric.unit.many} of every contender at the end of each month, ${seasonShort(season)}, ${n} ${n === 1 ? "month" : "months"}. The arrow keys move through the months and show every total at each, with what the month added. The league table lists the totals now.`,
    });
    const topTitle = season.allTime ? "Months top of the table" : `Months top of the table, ${season.name}`;
    return SiteLayout({
        title,
        site,
        scripts: [RACE_SCRIPT],
        children: `<section class="view" aria-labelledby="race-title">
      <div class="view-head">
        <div>
          <p class="eyebrow">${esc(`${seasonTitle(season)} · running ${rubric.unit.many}, month by month`)}</p>
          <h1 id="race-title" tabindex="-1">The race</h1>
        </div>
        <p class="view-note"><span class="race-note-wide">Hover or tap the chart for every running total at the end of any month, and what that month added. With the chart focused, the arrow keys move through the season.</span><span class="race-note-phone">Tap the chart for every running total at the end of any month, and what that month added. Tap a name under it to follow that line.</span></p>
      </div>
      <div class="card race-card">
        <div class="race-tools">
          <span class="field-label" id="race-pick-label">Follow</span>
          <div class="chips" role="group" aria-labelledby="race-pick-label">${chips}</div>
        </div>
        ${chart}
        <p class="chart-note">${esc(raceNote(site))}</p>
      </div>
      <div class="section-row">
        <h2 class="section-title">${esc(topTitle)}</h2>
      </div>
      <ol class="top-months">${topMonths(site)}</ol>
    </section>`,
    });
}
