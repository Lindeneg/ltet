import type {Content, RawStatement} from "../../lib/content.js";
import {isUrl} from "../../lib/statement-rules.js";
import {tally} from "../../lib/score.js";
import type {MaybeNull} from "../../lib/types.js";
import {esc} from "../lib.js";

const WHEN: Intl.DateTimeFormatOptions = {dateStyle: "medium", timeStyle: "short", timeZone: "UTC"};

// rendered in utc so every visitor gets the same html, and admin.js rewrites it in their own timezone
export function when(date: MaybeNull<Date>): string {
    if (!date) return "";
    return `<time datetime="${date.toISOString()}" data-local>${esc(date.toLocaleString("en-GB", WHEN))}</time>`;
}

export function extLink(url: unknown, text?: string): string {
    const label = esc(text ?? String(url ?? ""));
    if (!isUrl(url)) return `<span>${label}</span>`;
    return `<a href="${esc(new URL(url as string).href)}" target="_blank" rel="noopener noreferrer nofollow ugc">${label}</a>`;
}

export function ceoName(content: Content, id: unknown): string {
    return content.ceos.find((ceo) => ceo.id === id)?.name ?? (id ? String(id) : "someone");
}

export function categoryName(content: Content, id: unknown): string {
    return content.rubric.categories.find((category) => category.id === id)?.name ?? String(id);
}

export function forksOf(content: Content, statement: RawStatement): number | "?" {
    try {
        return tally(content.ceos, content.rubric, [statement]).statements[0].forks;
    } catch {
        return "?";
    }
}

export function ErrorBox(message?: string, errors: string[] = []): string {
    if (!message) return "";
    const list = errors.length ? `<ul class="plain">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "";
    return `<div class="error" role="alert"><p>${esc(message)}</p>${list}</div>`;
}

export type QuotePage = {url: string; verdict: string; found?: number; of?: number};

export type Checks = {
    verified?: boolean;
    foundOn?: number;
    headlineFound?: boolean;
    quotePages?: QuotePage[];
};

export function StatementSummary(content: Content, s: Partial<RawStatement>, checks?: MaybeNull<Checks>): string {
    const quoteTags = checks
        ? `<span class="tag ${checks.verified ? "good" : "warn"}">${esc(`Quote on ${checks.foundOn} site${checks.foundOn === 1 ? "" : "s"}`)}</span>
           <span class="tag ${checks.headlineFound ? "good" : "warn"}">${checks.headlineFound ? "Headline found" : "Headline not on its page"}</span>`
        : "";
    const leaked = s.leaked ? `<span class="tag warn">Leaked</span>` : "";
    const span = (text: unknown) => `<span>${esc(String(text ?? ""))}</span>`;
    const sources = (s.sources ?? [])
        .map((source) => `<li>${esc(`${source.outlet}: `)}${extLink(source.url, source.title)}</li>`)
        .join("");
    const pages = (checks?.quotePages ?? [])
        .map(
            (p) => `<li>${esc(`${p.verdict}${p.of ? ` (${p.found}/${p.of} fragments)` : ""}: `)}${extLink(p.url)}</li>`
        )
        .join("");
    const checksHtml = checks
        ? `<details><summary>What the checks found</summary><ul class="plain">${pages}</ul></details>`
        : "";
    return `
        <div class="meta">${quoteTags}${leaked}</div>
        <h2>${extLink(s.headline?.url, s.headline?.text ?? "(no headline)")}</h2>
        <div class="meta">
            ${span(ceoName(content, s.ceo))}${span(`${s.date} (${s.datePrecision})`)}${span(s.venue)}${span(s.headline?.outlet)}${span(s.backlashStrength)}
        </div>
        <blockquote>${esc(String(s.quote ?? ""))}</blockquote>
        <p class="note">Quote from ${extLink(s.quoteSource)}</p>
        <p>${esc(String(s.context ?? ""))}</p>
        <details>
            <summary>${esc(`Sources (${s.sources?.length ?? 0}) and backlash`)}</summary>
            <ul class="plain">${sources}</ul>
            <p>${esc(`Backlash: ${s.backlash?.summary ?? ""} `)}${extLink(s.backlash?.url, "(page)")}</p>
        </details>
        ${checksHtml}`;
}

export type EditorValues = {
    scores: Record<string, {score: string; reason: string}>;
    json: string;
};

export function editorValues(statement: Partial<RawStatement>): EditorValues {
    const {scores, ...rest} = statement;
    return {
        scores: Object.fromEntries(
            Object.entries(scores ?? {}).map(([id, s]) => [id, {score: String(s?.score ?? 0), reason: s?.reason ?? ""}])
        ),
        json: JSON.stringify(rest, null, 2),
    };
}

export function StatementEditor(content: Content, values: EditorValues, idPrefix = ""): string {
    const {rubric} = content;
    let total = 0;
    const rows = rubric.categories
        .map((category) => {
            const value = values.scores[category.id] ?? {score: "0", reason: ""};
            const score = Number(value.score);
            total += (Number.isFinite(score) ? score : 0) * category.weight;
            const id = `score_${idPrefix}${category.id}`;
            return `
                <label for="${esc(id)}">${esc(category.name)}</label>
                <input id="${esc(id)}" name="score_${esc(category.id)}" type="number" min="0" max="${rubric.maxPerCategory}" step="1" value="${esc(value.score)}" data-weight="${category.weight}" aria-label="${esc(`${category.name} score`)}" />
                <input name="reason_${esc(category.id)}" type="text" value="${esc(value.reason)}" aria-label="${esc(`${category.name} reason`)}" />`;
        })
        .join("");
    return `
        <div class="scores" data-scores>
            ${rows}
            <span>Total</span><span class="total" data-total data-unit="${esc(rubric.unit.many)}">${esc(`${Math.round(total)} ${rubric.unit.many}`)}</span><span></span>
        </div>
        <details>
            <summary>Edit every other field (JSON)</summary>
            <textarea name="json" rows="18" spellcheck="false" aria-label="Every other field, as JSON">${esc(values.json)}</textarea>
        </details>`;
}

// first in a form with several actions, so enter in a field submits nothing
export const NoImplicitSubmit = `<button type="submit" disabled hidden aria-hidden="true"></button>`;
