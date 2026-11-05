import type {Category} from "../../lib/content.js";
import {points, type ScoredStatement, type Standing} from "../../lib/score.js";
import type {MaybeNull} from "../../lib/types.js";
import {attrs, cardDate, esc, tickDate, widthClass} from "../lib.js";
import type {Site} from "../site.js";
import {face, publicCrest, type FaceSize} from "./face.js";

export const FORM_LENGTH = 5;

export const MILDEST_FIRST = ["critical commentary", "widespread criticism", "outrage"];

export const newestFirst = (a: ScoredStatement, b: ScoredStatement) => b.time - a.time;

export const strengthLevel = (st: ScoredStatement) => Math.max(0, MILDEST_FIRST.indexOf(st.backlashStrength));

export const abbrev = (category: Category) => category.id.split("-")[0].slice(0, 4).toUpperCase();

export function statementValues(site: Site, st: ScoredStatement): Record<string, number> {
    return Object.fromEntries(site.categories.map((c) => [c.id, points(st, c)]));
}

export function matchPath(id: string): string {
    return `/match/${encodeURIComponent(id)}`;
}

export function reportList(statements: ScoredStatement[]): string {
    return ` data-report-list="${esc(statements.map((st) => st.id).join(" "))}"`;
}

export function reportLink(st: ScoredStatement, className: string, label: MaybeNull<string>, inner: string): string {
    return `<a${attrs({class: className, href: matchPath(st.id), "data-report": st.id, "aria-label": label})}>${inner}</a>`;
}

export function splitBar(site: Site, values: Record<string, number>, scale: number, label?: string): string {
    const summary = site.categories.map((c) => `${c.name} ${Math.round(values[c.id])}`).join(", ");
    const total = site.categories.reduce((sum, c) => sum + values[c.id], 0);
    const segs = site.categories
        .filter((c) => values[c.id] > 0)
        .map((c) => `<span class="seg c-${esc(c.id)} ${widthClass(values[c.id] / total)}"></span>`)
        .join("");
    const fill = `<span class="split-fill ${widthClass(total / (scale || 1))}">${segs}</span>`;
    return `<span class="split" role="img" aria-label="${esc(label ? `${label}: ${summary}` : summary)}">${fill}</span>`;
}

export function categoryLegend(site: Site, lead = ""): string {
    const items = site.categories.map(
        (c) => `<li class="c-${esc(c.id)}"><i aria-hidden="true"></i>${esc(c.name)}</li>`
    );
    return `<ul class="legend">${lead}${items.join("")}</ul>`;
}

export function formChips(site: Site, row: Standing, size = ""): string {
    if (row.own.length === 0) return `<span class="form-none">No matches</span>`;
    const chips = row.own.slice(-FORM_LENGTH).map((st) => {
        const label = `${cardDate(st)}, ${st.forks} ${site.plural(st.forks)}, ${st.backlashStrength}: ${st.headline.text}`;
        return `<a${attrs({
            class: `fc f${strengthLevel(st)}`,
            href: matchPath(st.id),
            "data-report": st.id,
            title: `${tickDate(st)}: ${st.headline.text}`,
            "aria-label": label,
        })}>${st.forks}</a>`;
    });
    return `<span class="${esc(`form ${size}`.trim())}"${reportList([...row.own].sort(newestFirst))}>${chips.join("")}</span>`;
}

export function moveMark(site: Site, move: number): string {
    const text = site.moveWords.mark(move);
    const [kind, mark] = move > 0 ? ["up", "▲"] : move < 0 ? ["down", "▼"] : ["same", "•"];
    return `<span class="move ${kind}" title="${esc(text)}"><span aria-hidden="true">${mark}</span><span class="sr-only">${esc(text)}</span></span>`;
}

export function clubLink(site: Site, row: Standing, season = site.ctx.key): string {
    return `<a class="club-ref" href="${esc(site.href("club", row.ceo.id, season))}">${esc(row.ceo.name)}</a>`;
}

export function clubLinks(
    site: Site,
    rows: Standing[],
    season = site.ctx.key,
    size: MaybeNull<FaceSize> = null,
    gold = false
): string {
    return rows
        .map((row, i) => {
            const glue = i === 0 ? "" : i === rows.length - 1 ? " and " : ", ";
            const link = clubLink(site, row, season);
            return glue + (size ? `<span class="named">${face(row.ceo, {size, gold})}${link}</span>` : link);
        })
        .join("");
}

export function matchCard(site: Site, st: ScoredStatement, rank?: number): string {
    const label = `${rank ? `Number ${rank}. ` : ""}${st.who.name} ${st.forks} ${site.plural(st.forks)}, ${cardDate(st)}${st.leaked ? ", leaked" : ""}: ${st.headline.text}`;
    const inner = `<span class="m-top">${rank ? `<span class="m-rank">#${rank}</span>` : ""}<span class="m-date">${esc(cardDate(st))}</span><span class="m-venue">${esc(st.venue)}</span>${st.leaked ? `<span class="tag">Leaked</span>` : ""}<span class="ft">FT</span></span><span class="m-board"><span class="m-team home">${face(st.who, {gold: site.isChampion(st.ceo)})}<span class="m-name">${esc(st.who.shortName)}</span></span><span class="m-score"><span>${st.forks}</span></span><span class="m-team away"><span class="m-name">The Public</span>${publicCrest()}</span></span><span class="m-headline">${esc(st.headline.text)}</span><span class="m-foot"><span class="m-outlet">${esc(st.headline.outlet)}</span>${splitBar(site, statementValues(site, st), site.maxForks)}</span>`;
    return `<li class="match-item">${reportLink(st, "match", label, inner)}</li>`;
}

export function matchRow(site: Site, st: ScoredStatement): string {
    const label = `${st.forks} ${site.plural(st.forks)}, ${cardDate(st)}${st.leaked ? ", leaked" : ""}: ${st.headline.text}`;
    const inner = `<span class="m-score"><span>${st.forks}</span></span><span class="mr-main"><span class="mr-top"><span class="m-date">${esc(cardDate(st))}</span><span class="m-venue">${esc(st.venue)}</span>${st.leaked ? `<span class="tag">Leaked</span>` : ""}</span><span class="mr-headline">${esc(st.headline.text)}</span><span class="mr-foot"><span class="m-outlet">${esc(st.headline.outlet)}</span>${splitBar(site, statementValues(site, st), site.maxForks)}</span></span>`;
    return `<li>${reportLink(st, "mrow", label, inner)}</li>`;
}
