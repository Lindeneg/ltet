import type {Snapshot} from "../../lib/snapshots.js";
import {esc} from "../lib.js";

const LABEL_GAP = 17;
const LABEL_GAP_COMPACT = 16;
const PLOT_HEIGHT = 300;
const PLOT_HEIGHT_NARROW = 260;
const PLOT_HEIGHT_COMPACT = 180;
const LABEL_ROOM = 150;
const LABEL_ROOM_NARROW = 116;
const MARGIN = {top: 14, bottom: 34, left: 40};
const SCALE_MIN = 10;
const MONTH_LABELS_UP_TO = 14;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", {month: "long", year: "numeric", timeZone: "UTC"});

export type ChartContender = {id: string; shortName: string};

export type Band = "wide" | "narrow" | "compact";

// x is a percentage of the plot column and y is px from the top
export type Segment = {x1: number; y1: number; x2: number; y2: number};

export type ChartLayout = {
    band: Band;
    height: number;
    axisWidth: number;
    labelRoom: number;
    plotTop: number;
    plotBottom: number;
    grid: {y: number; value: number}[];
    months: {x: number; text: string; anchor: "start" | "middle"; short?: string}[];
    series: {
        id: string;
        name: string;
        total: number;
        segments: Segment[];
        label?: {y: number; anchorY: number};
        added: {cx: number; cy: number}[];
    }[];
    dotRadius: number;
};

const round = (value: number) => Math.round(value * 1000) / 1000;

export function niceScale(max: number): {top: number; step: number} {
    const rough = Math.max(1, max) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((v) => v >= rough)!;
    return {top: Math.max(step, Math.ceil(max / step) * step), step};
}

export function spreadLabels<T extends {y: number}>(labels: T[], top: number, bottom: number, gap: number): T[] {
    const sorted = labels.map((label) => ({...label})).sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) sorted[i].y = Math.max(sorted[i].y, sorted[i - 1].y + gap);
    const overflow = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
    if (overflow > 0) {
        for (const label of sorted) label.y -= overflow;
        for (let i = sorted.length - 2; i >= 0; i--) sorted[i].y = Math.min(sorted[i].y, sorted[i + 1].y - gap);
    }
    for (const label of sorted) label.y = Math.max(label.y, top);
    return sorted;
}

export function monthTitle(snap: Snapshot): string {
    const month = MONTH_FORMAT.format(new Date(snap.time));
    return snap.inPlay ? `${month}, so far` : `End of ${month}`;
}

function stepSegments(points: {x: number; y: number; jump: boolean}[], start: {x: number; y: number}): Segment[] {
    const segments: Segment[] = [];
    let at = start;
    let runFrom = start.x;
    const flush = () => {
        if (at.x !== runFrom) segments.push({x1: runFrom, y1: at.y, x2: at.x, y2: at.y});
    };
    for (const point of points) {
        at = {x: point.x, y: at.y};
        if (!point.jump || point.y === at.y) continue;
        flush();
        segments.push({x1: point.x, y1: at.y, x2: point.x, y2: point.y});
        at = {x: point.x, y: point.y};
        runFrom = point.x;
    }
    flush();
    return segments;
}

export function layoutRace(snapshots: Snapshot[], contenders: ChartContender[], band: Band): ChartLayout {
    const n = snapshots.length;
    const tight = band !== "wide";
    const labelRoom = tight ? LABEL_ROOM_NARROW : LABEL_ROOM;
    const gap = band === "compact" ? LABEL_GAP_COMPACT : LABEL_GAP;
    const maxTotal = Math.max(SCALE_MIN, ...snapshots.flatMap((snap) => snap.all.map((t) => t.total)));
    const scale = niceScale(maxTotal);
    const byMonth = n <= MONTH_LABELS_UP_TO;
    const plotHeight = {wide: PLOT_HEIGHT, narrow: PLOT_HEIGHT_NARROW, compact: PLOT_HEIGHT_COMPACT}[band];
    const plotBottom = MARGIN.top + plotHeight;
    const x = (i: number) => round(n <= 1 ? 50 : (i / (n - 1)) * 100);
    const y = (value: number) => round(plotBottom - (value / scale.top) * plotHeight);

    const grid = [{y: y(0), value: 0}];
    for (let value = scale.step; value <= scale.top + 0.001; value += scale.step) grid.push({y: y(value), value});

    const every = byMonth && tight ? 3 : 1;
    const months: ChartLayout["months"] = [];
    snapshots.forEach((snap, i) => {
        const labelled = byMonth ? i % every === 0 : snap.month === 0 || i === 0;
        if (!labelled) return;
        const withYear = every === 1 && (i === 0 || snap.month === 0);
        const name = MONTHS[snap.month];
        const text = byMonth ? (withYear ? `${name} ${snap.year}` : name) : String(snap.year);
        const short = tight && !byMonth && snap.month === 0 ? `’${String(snap.year).slice(-2)}` : undefined;
        months.push({x: x(i), text, anchor: i === 0 && !byMonth ? "start" : "middle", short});
    });

    const final = snapshots.at(-1);
    const labels = spreadLabels(
        (final?.all ?? []).filter((t) => t.total > 0).map((t) => ({id: t.id, y: y(t.total), anchorY: y(t.total)})),
        MARGIN.top - 6,
        plotBottom,
        gap
    );
    const labelFor = new Map(labels.map((l) => [l.id, {y: l.y, anchorY: l.anchorY}]));

    const series: ChartLayout["series"] = [];
    for (const c of contenders) {
        const first = snapshots.findIndex((snap) => (snap.totalById.get(c.id) ?? 0) > 0);
        if (first < 0) continue;
        const totalAt = (i: number) => snapshots[i].totalById.get(c.id) ?? 0;
        const addedAt = (i: number) => snapshots[i].addedById.get(c.id) ?? 0;
        const points = snapshots
            .slice(first)
            .map((_, k) => first + k)
            .map((i) => ({x: x(i), y: y(totalAt(i)), jump: i === first || addedAt(i) > 0}));
        series.push({
            id: c.id,
            name: c.shortName,
            total: final?.totalById.get(c.id) ?? 0,
            segments: stepSegments(points, {x: x(Math.max(0, first - 1)), y: y(0)}),
            label: labelFor.get(c.id),
            added: snapshots.flatMap((_, i) => (addedAt(i) > 0 ? [{cx: x(i), cy: y(totalAt(i))}] : [])),
        });
    }

    return {
        band,
        height: plotBottom + MARGIN.bottom,
        axisWidth: MARGIN.left,
        labelRoom,
        plotTop: MARGIN.top,
        plotBottom,
        grid,
        months,
        series,
        dotRadius: band === "compact" ? 3 : 4.5,
    };
}

const pct = (value: number) => `${value}%`;

const segmentLines = (segments: Segment[]) =>
    segments.map((s) => `<line x1="${pct(s.x1)}" y1="${s.y1}" x2="${pct(s.x2)}" y2="${s.y2}"></line>`).join("");

const byActiveLast = <T extends {id: string}>(items: T[], activeId: string) =>
    [...items].sort((a, b) => Number(a.id === activeId) - Number(b.id === activeId));

function bandMarkup(layout: ChartLayout, activeId: string, hrefFor?: (id: string) => string): string {
    const {height, plotBottom} = layout;
    const series = byActiveLast(layout.series, activeId);
    const seriesAttrs = (id: string) =>
        `class="series${id === activeId ? " active" : ""}" data-id="${esc(id)}"${
            hrefFor ? ` data-href="${esc(hrefFor(id))}"` : ""
        }`;

    const axis = layout.grid
        .map((g) => `<text x="${layout.axisWidth - 10}" y="${round(g.y + 4)}" text-anchor="end">${g.value}</text>`)
        .join("");
    const gridLines = layout.grid
        .filter((g) => g.value > 0)
        .map((g) => `<line x1="0" x2="100%" y1="${g.y}" y2="${g.y}"></line>`)
        .join("");
    const ticks = layout.months
        .map(
            (m) =>
                `<line class="tick" x1="${pct(m.x)}" x2="${pct(m.x)}" y1="${plotBottom + 4}" y2="${plotBottom + 10}"></line>`
        )
        .join("");
    const shortYears = layout.months.some((m) => m.short);
    const monthLabels = layout.months
        .map((m) => {
            const text = `<text${shortYears ? ` class="long"` : ""} x="${pct(m.x)}" y="${plotBottom + 24}" text-anchor="${m.anchor}">${esc(m.text)}</text>`;
            const short = m.short
                ? `<text class="short" x="${pct(m.x)}" y="${plotBottom + 24}" text-anchor="middle">${esc(m.short)}</text>`
                : "";
            return text + short;
        })
        .join("");
    const lines = series
        .map(
            (s) =>
                `<g ${seriesAttrs(s.id)}><g class="line">${segmentLines(s.segments)}</g><g class="hit">${segmentLines(
                    s.segments
                )}</g>${s.added
                    .map(
                        (a) => `<circle class="added" cx="${pct(a.cx)}" cy="${a.cy}" r="${layout.dotRadius}"></circle>`
                    )
                    .join("")}</g>`
        )
        .join("");
    const labels = series
        .filter((s) => s.label)
        .map((s) => {
            const {y, anchorY} = s.label!;
            const leader = Math.abs(y - anchorY) > 1 ? `<path class="leader" d="M2,${anchorY}L9,${y}"></path>` : "";
            return `<g ${seriesAttrs(s.id)}>${leader}<text class="name" x="14" y="${round(y + 4)}">${esc(
                s.name
            )}</text><text class="total" x="${layout.labelRoom - 4}" y="${round(y + 4)}" text-anchor="end">${
                s.total
            }</text></g>`;
        })
        .join("");

    return `<div class="bump race-grid race-${layout.band}${layout.band === "compact" ? " compact" : ""}">
        <svg class="race-axis" width="${layout.axisWidth}" height="${height}" aria-hidden="true"><g class="axis">${axis}</g></svg>
        <div class="race-plot">
            <svg class="race-lines" width="100%" height="${height}" aria-hidden="true"><g class="grid">${gridLines}${ticks}</g><g class="axis">${monthLabels}</g><line class="baseline" x1="0" x2="100%" y1="${plotBottom}" y2="${plotBottom}"></line><line class="crosshair" x1="0" x2="0" y1="${layout.plotTop - 8}" y2="${plotBottom}" visibility="hidden"></line>${lines}</svg>
        </div>
        <svg class="race-labels" width="${layout.labelRoom}" height="${height}" aria-hidden="true">${labels}</svg>
    </div>`;
}

export type RaceChartProps = {
    snapshots: Snapshot[];
    contenders: ChartContender[];
    activeId: string;
    label: string;
    compact?: boolean;
    hrefFor?: (id: string) => string;
    rankLabel: string;
};

function rankList({snapshots, contenders, activeId, hrefFor, rankLabel}: RaceChartProps): string {
    const final = snapshots.at(-1);
    const items = contenders
        .map((c) => {
            const on = c.id === activeId;
            const body = `<span class="rank-name">${esc(c.shortName)}</span><span class="rank-total">${final?.totalById.get(c.id) ?? 0}</span>`;
            const item = hrefFor
                ? `<a href="${esc(hrefFor(c.id))}"${on ? ` aria-current="page"` : ""}>${body}</a>`
                : `<button type="button" data-follow="${esc(c.id)}" aria-pressed="${on}">${body}</button>`;
            return `<li>${item}</li>`;
        })
        .join("");
    const label = hrefFor
        ? `<ol class="race-rank" aria-label="${esc(rankLabel)}">`
        : `<p class="field-label race-rank-label" id="race-rank-label">${esc(rankLabel)}</p><ol class="race-rank" aria-labelledby="race-rank-label">`;
    return `${label}${items}</ol>`;
}

function tooltipData(snapshots: Snapshot[], contenders: ChartContender[]): string {
    const names = new Map(contenders.map((c) => [c.id, c.shortName]));
    const months = snapshots.map((snap) => ({
        title: monthTitle(snap),
        rows: snap.all.map((t) => ({
            id: t.id,
            pos: t.pos === null ? "" : `${t.tied ? "=" : ""}${t.pos}`,
            name: names.get(t.id) ?? t.id,
            total: t.total,
            added: t.added,
        })),
    }));
    return JSON.stringify(months).replace(/</g, "\\u003c");
}

export function RaceChart(props: RaceChartProps): string {
    const {snapshots, contenders, activeId, label, compact = false, hrefFor} = props;
    const bands: Band[] = compact ? ["compact"] : ["wide", "narrow"];
    const charts = bands.map((band) => bandMarkup(layoutRace(snapshots, contenders, band), activeId, hrefFor));
    return `<div class="race-chart${compact ? " compact" : ""}" data-race-chart data-active="${esc(activeId)}">
        <div class="bump-frame race-frame" tabindex="0" role="group" aria-label="${esc(label)}">${charts.join("")}</div>
        ${rankList(props)}
        <script type="application/json" class="race-data">${tooltipData(snapshots, contenders)}</script>
        <div class="tooltip" hidden></div>
    </div>`;
}
