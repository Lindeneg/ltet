import type {ScoredStatement} from "../../lib/score.js";
import {icon} from "../icons.js";
import {cardDate, esc, formatDate, sentence} from "../lib.js";
import type {Site} from "../site.js";
import {crest, face, publicCrest} from "./face.js";

export const COMMENT_CHARS = 500;
export const QUOTE_CHARS = 1000;

function external(url: string, inner: string): string {
    return `<a href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>`;
}

export function honeypot(id: string): string {
    return `<div class="hp" aria-hidden="true"><label for="${id}">Website</label><input id="${id}" name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true"></div>`;
}

type Tab = {id: string; label: string; content: string};

function tabs(definitions: Tab[]): string {
    const bar = definitions
        .map(
            (def, i) =>
                `<button type="button" role="tab" id="tab-${def.id}" data-tab="${def.id}" aria-controls="panel-${def.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(def.label)}</button>`
        )
        .join("");
    const panels = definitions
        .map(
            (def, i) =>
                `<div class="rp-panel" role="tabpanel" id="panel-${def.id}" data-tab="${def.id}" aria-labelledby="tab-${def.id}" tabindex="0"${i === 0 ? "" : " hidden"}>${def.content}</div>`
        )
        .join("");
    return `<div class="rp-tabs" role="tablist" aria-label="Match details">${bar}</div>${panels}`;
}

function varPanel(site: Site, st: ScoredStatement): string {
    const {categories, rubric} = site;
    const choice = (name: string, value: string, label: string) =>
        `<label class="choice"><input type="radio" name="${name}" value="${esc(value)}">${label}</label>`;
    const counts = categories
        .map((c) =>
            choice(
                "var-count",
                c.id,
                `<i class="dot c-${esc(c.id)}" aria-hidden="true"></i><span class="choice-name">${esc(c.name)}</span><span class="choice-now">${st.scores[c.id].score}/${rubric.maxPerCategory}</span>`
            )
        )
        .join("");
    return `<section class="var" aria-label="Video referee" data-var="${esc(st.id)}">
      <div class="var-row"><p class="var-lead">Think the referee got a count wrong?</p><button type="button" class="var-open" aria-controls="var-form" aria-expanded="false">${icon("screen")}Call for VAR</button></div>
      <form class="feedback-form var-form" id="var-form" novalidate hidden aria-labelledby="var-title" data-unit-many="${esc(rubric.unit.many)}">
        <h3 class="var-title" id="var-title">VAR review</h3>
        <fieldset class="choices"><legend class="field-label">Which count? <span class="req">(required)</span></legend>${counts}</fieldset>
        <fieldset class="choices two"><legend class="field-label">The call <span class="req">(required)</span></legend>${choice("var-direction", "more", esc(`More ${rubric.unit.many}`))}${choice("var-direction", "fewer", esc(`Fewer ${rubric.unit.many}`))}</fieldset>
        <div class="field"><label class="field-label" for="var-reason">Your reason <span class="opt">(optional)</span></label><textarea id="var-reason" name="comment" maxlength="${COMMENT_CHARS}" rows="3"></textarea><span class="char-count" aria-hidden="true"></span></div>
        ${honeypot("var-website")}
        <p class="form-error" role="alert"></p>
        <div class="form-actions"><button type="submit" class="button">Send to VAR</button><button type="button" class="button ghost" data-var-cancel>Cancel</button></div>
      </form>
      <p class="var-thanks" tabindex="-1" hidden><strong>Call received. </strong>VAR is having a look: the referee reviews every call, and the score stands until then.</p>
    </section>`;
}

function stats(site: Site, st: ScoredStatement): string {
    const {categories, rubric, plural, maxForks} = site;
    const items = categories
        .map((c) => {
            const score = st.scores[c.id];
            const pips = Array.from(
                {length: rubric.maxPerCategory},
                (_, i) => `<span class="${i < score.score ? "pip on" : "pip"}"></span>`
            ).join("");
            return `<li class="stat c-${esc(c.id)}"><div class="stat-head"><span class="stat-name"><i class="dot" aria-hidden="true"></i>${esc(c.name)}</span><span class="stat-score"><strong>${score.score}</strong>/${rubric.maxPerCategory}${c.weight !== 1 ? ` × ${c.weight}` : ""}</span></div><span class="pips" aria-hidden="true">${pips}</span><p class="stat-reason">${esc(score.reason)}</p></li>`;
        })
        .join("");
    return `<ol class="stats">${items}</ol><p class="stats-total"><span>Full time</span><strong>${esc(`${st.forks} ${plural(st.forks)}`)}</strong><span>of a possible ${maxForks}</span></p>${varPanel(site, st)}`;
}

function context(st: ScoredStatement): string {
    return `<h3 class="rp-sub">The occasion</h3><p>${esc(`${st.venue}, ${formatDate(st)}.`)}</p><h3 class="rp-sub">Context</h3><p>${esc(st.context)}</p><h3 class="rp-sub">Crowd reaction</h3><p class="crowd"><strong>${esc(sentence(st.backlashStrength))}</strong></p><p>${esc(st.backlash.summary)}</p><p>${external(st.backlash.url, "See the reaction")}</p>`;
}

function sources(st: ScoredStatement): string {
    const primary = st.primarySource
        ? `<li>${external(st.primarySource.url, `<span class="outlet">Primary source</span>`)}<span class="note">, ${esc(st.primarySource.kind)}</span></li>`
        : "";
    const outlets = st.sources
        .map(
            (source) =>
                `<li>${external(source.url, `<span class="outlet">${esc(source.outlet)}</span>: ${esc(source.title)}`)}</li>`
        )
        .join("");
    const words = `<li>${external(st.quoteSource, `<span class="outlet">Where the exact words are printed</span>`)}</li>`;
    return `<ul class="sources">${primary}${outlets}${words}</ul>`;
}

export function ReportBody(site: Site, st: ScoredStatement): string {
    const {plural, maxForks} = site;
    const champion = site.isChampion(st.ceo);
    const sourceCount = st.sources.length + (st.primarySource ? 1 : 0) + 1;
    return `<p class="rp-meta"><span class="ft">FT</span><span>${esc(cardDate(st))}</span>${st.leaked ? `<span class="tag">Leaked</span>` : ""}</p>
      <h1 class="rp-headline" id="report-headline">${external(st.headline.url, esc(st.headline.text))}</h1>
      <p class="rp-outlet">${esc(st.headline.outlet)}</p>
      <div class="scoreboard" data-ceo="${esc(st.ceo)}">
        <a class="sb-team home" href="${esc(site.href("club", st.ceo))}">${crest(st.who, `lg${champion ? " gold" : ""}`)}<span class="sb-name">${esc(st.who.name)}</span><span class="sb-co">${esc(st.who.company)}</span></a>
        <div class="sb-score"><span class="sb-num">${st.forks}</span><span class="sb-unit">${esc(`${plural(st.forks)} of ${maxForks}`)}</span></div>
        <div class="sb-team away">${publicCrest("lg")}<span class="sb-name">The Public</span><span class="sb-co">${esc(`Crowd: ${st.backlashStrength}`)}</span></div>
        <p class="sb-venue">${esc(st.venue)}</p>
      </div>
      <figure class="rp-said">
        <blockquote class="rp-quote"><p>${esc(`“${st.quote}”`)}</p></blockquote>
        <figcaption class="rp-speaker">${face(st.who, {size: "lg", gold: champion, eager: true, beside: false})}<span class="rp-speaker-text"><strong>${esc(st.who.name)}</strong><span>${esc(formatDate(st))}</span></span></figcaption>
      </figure>
      ${tabs([
          {id: "stats", label: "Stats", content: stats(site, st)},
          {id: "report", label: "Report", content: context(st)},
          {id: "sources", label: `Sources (${sourceCount})`, content: sources(st)},
      ])}`;
}
