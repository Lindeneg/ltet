import {LEVELS, type Category, type Ceo} from "../../../lib/content.js";
import {SiteLayout} from "../../components/layout.js";
import {photoCredit} from "../../components/face.js";
import {FORM_LENGTH, MILDEST_FIRST, abbrev} from "../../components/pieces.js";
import {esc} from "../../lib.js";
import {recordStartText, type Site} from "../../site.js";

const RANKING =
    "The table ranks contenders on their total, so every statement counts. The full table's Avg column gives the average per match.";

export const RULES_SCRIPT = "/rules.js";

type Law = {id: string; kicker?: string; title: string; body: string};

const term = (name: string, definition: string) => `<dt>${name}</dt><dd>${esc(definition)}</dd>`;

function honour(name: string, why: string, category?: Category): string {
    const cat = category
        ? `<span class="lh-cat"><i class="dot" aria-hidden="true"></i>${esc(category.name)}</span>`
        : "";
    return `<li class="law-honour${category ? ` c-${esc(category.id)}` : ""}"><span class="lh-head"><span class="lh-name">${esc(name)}</span>${cat}</span><span class="lh-for">${esc(why)}</span></li>`;
}

function laws(site: Site, ceos: Ceo[]): Law[] {
    const {rubric, categories, maxForks, league} = site;
    const {seasons} = league;
    const weighted = categories.some((c) => c.weight !== 1);
    const counts = categories
        .map(
            (c) =>
                `<li class="c-${esc(c.id)}"><span class="lc-head"><strong>${esc(c.name)}</strong><abbr title="${esc(c.name)}">${esc(abbrev(c))}</abbr>${weighted ? `<span class="weight">${esc(`× ${c.weight}`)}</span>` : ""}</span><span class="lc-q">${esc(c.question)}</span><dl class="lc-levels">${LEVELS.map((level) => `<div><dt>${level}</dt><dd>${esc(c.levels[level])}</dd></div>`).join("")}</dl></li>`
        )
        .join("");
    const abbrs = categories
        .map((c) => `<abbr class="c-${esc(c.id)}" title="${esc(c.name)}">${esc(abbrev(c))}</abbr>`)
        .join("");
    const credits = ceos
        .filter((ceo) => ceo.photo)
        .map((ceo) => `<li><strong>${esc(ceo.name)}</strong>: ${photoCredit(ceo.photo!)}</li>`)
        .join("");
    return [
        {
            id: "scoring",
            title: "Scoring",
            body: `<p>${esc(`Every statement is a match: the contender against The Public. It is judged on ${categories.length} counts, each scored 0 to ${rubric.maxPerCategory}${weighted ? " and weighted as shown" : ""}. Its ${rubric.unit.many} are the sum, ${maxForks} at most, and they are the score. ${RANKING} The reasons are printed beside every score in the match report; the referee is biased, and says so.`)}</p><ol class="law-counts">${counts}</ol>`,
        },
        {
            id: "table",
            title: "The table",
            body: `<dl class="law-terms">${[
                term("P", "Played: the statements on the record."),
                term("Pts", `Points: every ${rubric.unit.one} his statements raised. The table is ordered by them.`),
                term(`<span class="abbrs">${abbrs}</span>`, `His ${rubric.unit.many} on each count.`),
                term(
                    "Form",
                    `His last ${FORM_LENGTH} statements, latest on the right. The fill is the crowd's reaction, from ${MILDEST_FIRST[0]} to ${MILDEST_FIRST.at(-1)}.`
                ),
                term("=4", `Equal ${rubric.unit.many}, equal position. There is no goal difference in disgrace.`),
                term("Zones", `${rubric.titles.first} is the top of the table; ${rubric.titles.last} is the foot.`),
            ].join("")}</dl>`,
        },
        {
            id: "seasons",
            title: "Seasons",
            body: `<p>${esc(`A season runs from 1 August to 31 July, as a football season does, and is named by its two years: ${seasons[1]?.name ?? seasons[0].name}. The first, ${seasons.at(-1)!.name}, opened with the record itself on ${recordStartText}, and so ran short. Each season crowns its own ${rubric.titles.first}, finds its own ${rubric.titles.last} and bakes its own ${rubric.titles.topStatement.name}; the all-time table adds every season together.`)}</p>`,
        },
        {
            id: "eligibility",
            title: "Eligibility",
            body: `<p>To enter the record a statement must be the contender's own words, said in public or leaked and reported, about technology, work or the people who use it, and it must have met with documented disapproval. One statement per occasion. Each is confirmed word for word against a published source and carries at least two.</p>`,
        },
        {
            id: "honours",
            title: "Honours",
            body: `<ul class="law-honours">${[
                honour(rubric.titles.first, `for raising the most ${rubric.unit.many} of all`),
                honour(rubric.titles.topStatement.name, rubric.titles.topStatement.for),
                ...categories.map((c) => honour(c.award.name, c.award.for, c)),
                honour(rubric.titles.last, `for raising the fewest ${rubric.unit.many} of all`),
            ].join("")}</ul>`,
        },
        {
            id: "credits",
            kicker: "Credits",
            title: "Photo credits",
            body: `<p>The contenders' photos are free-licensed, from Wikimedia Commons, shown as taken and only cropped.</p><ul class="law-credits">${credits}</ul>`,
        },
    ];
}

export type RulesViewProps = {site: Site; title: string; ceos: Ceo[]};

export function RulesView({site, title, ceos}: RulesViewProps): string {
    const all = laws(site, ceos);
    const kicker = (law: Law, i: number) => law.kicker ?? `Law ${i + 1}`;
    const index = all
        .map(
            (law, i) =>
                `<li><a href="#law-${law.id}" data-law="${law.id}"${i === 0 ? ` aria-current="true"` : ""}><span class="law-n">${esc(kicker(law, i))}</span><span>${esc(law.title)}</span></a></li>`
        )
        .join("");
    const sections = all
        .map(
            (law, i) =>
                `<section class="law" id="law-${law.id}" aria-labelledby="law-${law.id}-title"><p class="law-n">${esc(kicker(law, i))}</p><h2 class="law-title" id="law-${law.id}-title" tabindex="-1">${esc(law.title)}</h2>${law.body}</section>`
        )
        .join("");
    return SiteLayout({
        title,
        site,
        scripts: [RULES_SCRIPT],
        children: `<section class="view" aria-labelledby="rules-title">
      <div class="view-head">
        <div>
          <p class="eyebrow">How the league is scored</p>
          <h1 id="rules-title" tabindex="-1">Laws of the game</h1>
        </div>
      </div>
      <div class="rules"><nav class="law-nav" aria-label="The laws"><ol class="law-index">${index}</ol></nav><article class="rulebook card">${sections}</article></div>
    </section>`,
    });
}
