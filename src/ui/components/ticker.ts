import type {ScoredStatement} from "../../lib/score.js";
import {icon} from "../icons.js";
import {attrs, esc, tickDate} from "../lib.js";
import {matchPath, reportList} from "./pieces.js";

function tick(st: ScoredStatement, copy: boolean): string {
    const link = attrs({
        class: "tick",
        href: matchPath(st.id),
        "data-report": copy ? null : st.id,
        tabindex: copy ? "-1" : null,
        "aria-label": copy ? null : `${tickDate(st)}, ${st.who.name} ${st.forks}, The Public: ${st.headline.text}`,
    });
    return `<li><a${link}><span class="tick-date">${esc(tickDate(st))}</span><span class="tick-home">${esc(st.who.shortName)}</span><span class="tick-score">${st.forks}</span><span class="tick-away">The Public</span></a></li>`;
}

export function Ticker(newest: ScoredStatement[], paused = false): string {
    const ticks = (copy: boolean) => newest.map((st) => tick(st, copy)).join("");
    const toggle = paused ? "Play the results ticker" : "Pause the results ticker";
    return `<div class="ticker" id="ticker"${paused ? " data-paused" : ""}>
    <p class="ticker-label" id="ticker-label">Latest<span class="tl-more">&nbsp;results</span></p>
    <div class="ticker-track" id="ticker-track">
      <div class="ticker-belt" id="ticker-belt">
        <ol id="ticker-list" class="ticker-list" aria-labelledby="ticker-label" aria-describedby="ticker-help"${reportList(newest)}>${ticks(false)}</ol>
        <ol class="ticker-list copy" aria-hidden="true">${ticks(true)}</ol>
      </div>
    </div>
    <p id="ticker-help" class="sr-only">Every result, newest first. The left and right arrow keys move from one to the next.</p>
    <button type="button" class="ticker-toggle" id="ticker-toggle" aria-label="${toggle}" title="${toggle}">
      ${icon(paused ? "play" : "pause")}
    </button>
  </div>`;
}
