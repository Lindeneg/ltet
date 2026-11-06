import type {ScoredStatement} from "../../../lib/score.js";
import type {MaybeUndefined} from "../../../lib/types.js";
import {SiteLayout} from "../../components/layout.js";
import {matchPath} from "../../components/pieces.js";
import {ReportBody} from "../../components/report.js";
import {esc} from "../../lib.js";
import type {Site} from "../../site.js";

function step(target: MaybeUndefined<ScoredStatement>, inner: string): string {
    if (!target) return `<button type="button" class="nav-button" disabled>${inner}</button>`;
    return `<a class="nav-button" href="${esc(matchPath(target.id))}">${inner}</a>`;
}

export type MatchViewProps = {site: Site; title: string; statement: ScoredStatement};

export function MatchView({site, title, statement}: MatchViewProps): string {
    const all = site.league.record.statements;
    const at = all.findIndex((st) => st.id === statement.id);
    const prev = step(all[at - 1], `<span aria-hidden="true">&larr;</span> <span class="nav-text">Previous</span>`);
    const next = step(all[at + 1], `<span class="nav-text">Next</span> <span aria-hidden="true">&rarr;</span>`);
    return SiteLayout({
        title,
        site,
        tickerPaused: true,
        children: `<section class="view" aria-labelledby="report-headline">
      <article class="report-page">
        <div class="report-frame">
          <header class="report-bar">
            <span class="report-label">Match report</span>
            <span class="report-position">${at + 1} of ${all.length}</span>
          </header>
          <div class="report-body" data-report-body>${ReportBody(site, statement)}</div>
          <footer class="report-nav">
            ${prev}
            <button type="button" class="nav-button copy" data-copy="/s/${esc(encodeURIComponent(statement.id))}">Copy link</button>
            ${next}
          </footer>
        </div>
      </article>
    </section>`,
    });
}
