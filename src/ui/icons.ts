export type IconName =
    | "pitchfork"
    | "league-crest"
    | "cup"
    | "pause"
    | "play"
    | "screen"
    | "sun"
    | "moon"
    | "chevron"
    | "tab-table"
    | "tab-results"
    | "tab-race"
    | "tab-honours"
    | "tab-rules";

export function icon(name: IconName, className = "icon"): string {
    return `<svg class="${className}" aria-hidden="true"><use href="#${name}"/></svg>`;
}

export const CLOSE_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

// in the page itself, since css clips the faces with #shield-clip
export const SPRITE = `<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false">
    <symbol id="pitchfork" viewBox="0 0 24 24">
      <path d="M12 9.5V23M5 2v4.5a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V2M12 2v8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="league-crest" viewBox="0 0 40 46">
      <path class="lc-shield" d="M3 3h34v20c0 10.5-7.6 17-17 20.5C10.6 40 3 33.5 3 23z" stroke-width="2.5" stroke-linejoin="round"/>
      <path class="lc-fork" d="M20 17v19M12.5 9v5.5a4 4 0 0 0 4 4h7a4 4 0 0 0 4-4V9M20 9v9.5" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="cup" viewBox="0 0 24 24">
      <path d="M7 3h10v5a5 5 0 0 1-10 0zM7 5H4v1.5A3.5 3.5 0 0 0 7.5 10M17 5h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 13v4M8.5 21h7M9.5 17h5v4h-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="pause" viewBox="0 0 24 24">
      <path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </symbol>
    <symbol id="play" viewBox="0 0 24 24">
      <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    </symbol>
    <clipPath id="shield-clip" clipPathUnits="objectBoundingBox">
      <path d="M0 0H1V0.47C1 0.72 0.81 0.88 0.5 1C0.19 0.88 0 0.72 0 0.47Z"/>
    </clipPath>
    <symbol id="screen" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4M10 8.5v3.5l3-1.75z"/></g>
    </symbol>
    <symbol id="sun" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g>
    </symbol>
    <symbol id="moon" viewBox="0 0 24 24">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </symbol>
    <symbol id="chevron" viewBox="0 0 24 24">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="tab-table" viewBox="0 0 24 24">
      <path d="M4 6h.01M4 12h.01M4 18h.01M9 6h11M9 12h11M9 18h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="tab-results" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8l3.8 2.8-1.5 4.4H9.7l-1.5-4.4zM12 3v5M15.8 10.8l4.8-1.6M14.3 15.2l3 4M9.7 15.2l-3 4M8.2 10.8L3.4 9.2"/></g>
    </symbol>
    <symbol id="tab-race" viewBox="0 0 24 24">
      <path d="M3 3v18h18M7 15l4-4 3 3 6-6M15 8h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="tab-honours" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5l3 6.5M16 2.5l-3 6.5"/><circle cx="12" cy="15" r="6"/><path d="M12 12.5l.8 1.6 1.7.2-1.3 1.2.3 1.7-1.5-.8-1.5.8.3-1.7-1.3-1.2 1.7-.2z"/></g>
    </symbol>
    <symbol id="tab-rules" viewBox="0 0 24 24">
      <path d="M12 6.5C10 5 7 4.5 3 5v13.5c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5zM12 6.5V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
  </svg>`;
