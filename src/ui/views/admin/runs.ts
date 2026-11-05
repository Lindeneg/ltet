import type {RunListItem, RunStatus} from "../../../repositories/run-repository.js";
import type {MaybeNull} from "../../../lib/types.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {ErrorBox, when} from "../../components/admin-parts.js";
import {esc} from "../../lib.js";
import {RECORD_START_DAY, formatCost} from "../../../lib/scout.js";
import type {AdminPage} from "./page.js";

type Summary = {since?: string; proposed?: number; dropped?: number; failed?: number; costUsd?: number};

const COLUMNS = [
    "Run",
    "Started",
    "Started by",
    "Status",
    "Since",
    "Proposed",
    "Dropped",
    "Failed checks",
    "Cost estimate",
];

const RECORD_START = RECORD_START_DAY;

export const STATUS_LABELS: Record<RunStatus, string> = {
    running: "Running",
    ok: "Done",
    failed: "Failed",
    stopped: "Stopped",
};

export function statusText(run: Pick<RunListItem, "status" | "dryRun">): string {
    const dry = run.dryRun ? ` <span class="tag">Dry run</span>` : "";
    return `<span>${esc(STATUS_LABELS[run.status])}${dry}</span>`;
}

export function startedByText(startedBy: MaybeNull<string>): string {
    if (startedBy === null) return "By hand";
    return startedBy === "schedule" ? "Schedule" : startedBy;
}

export function utcTime(date: Date): string {
    const text = date.toLocaleString("en-GB", {dateStyle: "medium", timeStyle: "short", timeZone: "UTC"});
    return `<time datetime="${date.toISOString()}">${esc(text)}</time>`;
}

export type RunForm = {since?: string; dryRun?: boolean; error?: string};

export type RunsViewProps = {
    page: AdminPage;
    runs: RunListItem[];
    pageNo?: number;
    pages?: number;
    nextRun?: MaybeNull<Date>;
    today?: string;
    form?: RunForm;
};

function startForm(nextRun: MaybeNull<Date>, today: string, form: RunForm): string {
    const next = nextRun
        ? `Next run: ${utcTime(nextRun)} UTC`
        : "Next run: none, the schedule runs only in production.";
    return `<section class="card">
                <h2>Run the scout</h2>
                <p class="note">${next}</p>
                <form method="post" action="/admin/runs" class="stack">
                    ${ErrorBox(form.error)}
                    <label>Since (optional, YYYY-MM-DD) <input name="since" type="date" min="${RECORD_START}" max="${esc(today)}" value="${esc(form.since ?? "")}" /></label>
                    <label class="check"><input name="dryRun" type="checkbox" value="1"${form.dryRun ? " checked" : ""} /> Dry run (nothing goes to the inbox)</label>
                    <div class="actions"><button type="submit">Run the scout</button></div>
                </form>
            </section>`;
}

function pager(pageNo: number, pages: number): string {
    if (pages <= 1) return "";
    const href = (n: number) => (n === 1 ? "/admin/runs" : `/admin/runs?page=${n}`);
    const newer = pageNo > 1 ? `<a class="button quiet" href="${href(pageNo - 1)}">Newer</a>` : "";
    const older = pageNo < pages ? `<a class="button quiet" href="${href(pageNo + 1)}">Older</a>` : "";
    return `<nav class="actions pager" aria-label="Pages">${newer}${older}</nav>`;
}

export function RunsView({
    page,
    runs,
    pageNo = 1,
    pages = 1,
    nextRun = null,
    today = new Date().toISOString().slice(0, 10),
    form = {},
}: RunsViewProps): string {
    const cell = (label: string, html: string, num = false) =>
        `<td data-label="${esc(label)}"${num ? ` class="num"` : ""}>${html}</td>`;
    const text = (value: unknown) => esc(String(value ?? ""));
    const rows = runs
        .map((r) => {
            const s = (r.summary ?? {}) as Summary;
            return `<tr>
                ${cell("Run", `<a href="/admin/runs/${r.id}">#${r.id}</a>`)}
                ${cell("Started", when(r.startedAt))}
                ${cell("Started by", text(startedByText(r.startedBy)))}
                ${cell("Status", statusText(r))}
                ${cell("Since", s.since ? `<span class="nowrap">${text(s.since)}</span>` : "")}
                ${cell("Proposed", text(s.proposed), true)}
                ${cell("Dropped", text(s.dropped), true)}
                ${cell("Failed checks", text(s.failed), true)}
                ${cell("Cost estimate", s.costUsd != null ? text(formatCost(s.costUsd)) : "", true)}
            </tr>`;
        })
        .join("");
    const body =
        runs.length === 0
            ? `<p class="empty">The scout has not run yet. Start one above, or wait for the next scheduled run.</p>`
            : `<table class="cards">
                <thead><tr>${COLUMNS.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
                <tbody>${rows}</tbody>
              </table>
              ${pager(pageNo, pages)}
              <p class="note">The cost is Claude Code's list-price estimate; on a subscription it is usage of the plan, not a bill.</p>`;
    return AdminLayout({
        ...page,
        children: `
            <div class="toolbar"><h1>The scout's runs</h1></div>
            ${startForm(nextRun, today, form)}
            ${body}`,
    });
}
