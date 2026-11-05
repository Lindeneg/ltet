import type {RunProposal, RunRecord} from "../../../repositories/run-repository.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {when} from "../../components/admin-parts.js";
import {esc} from "../../lib.js";
import {formatCost} from "../../../lib/scout.js";
import type {AdminPage} from "./page.js";
import {STATUS_LABELS, startedByText} from "./runs.js";

const REFRESH_SECONDS = 5;

const SUMMARY: Array<[string, string]> = [
    ["since", "Since"],
    ["model", "Model"],
    ["leads", "Leads"],
    ["proposed", "Proposed"],
    ["verified", "Verified"],
    ["onePage", "On one site"],
    ["dropped", "Dropped"],
    ["duplicates", "Duplicates"],
    ["failed", "Failed checks"],
    ["suggestions", "Suggestions researched"],
    ["costUsd", "Cost estimate"],
];

function summaryList(summary: unknown): string {
    if (!summary || typeof summary !== "object") return "";
    const values = summary as Record<string, unknown>;
    const items = SUMMARY.filter(([key]) => values[key] != null)
        .map(([key, label]) => {
            const value = key === "costUsd" ? formatCost(Number(values[key])) : String(values[key]);
            return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
        })
        .join("");
    return items ? `<dl class="summary">${items}</dl>` : "";
}

function proposalList(proposals: RunProposal[]): string {
    if (proposals.length === 0) return "";
    const items = proposals
        .map(
            (p) =>
                `<li><a href="/admin?status=all#proposal-${p.id}">${esc(`#${p.id} ${p.statementId ?? ""}`.trim())}</a></li>`
        )
        .join("");
    return `<section class="card"><h2>Proposals</h2><ul class="plain">${items}</ul></section>`;
}

export type RunViewProps = {page: AdminPage; run: RunRecord; proposals?: RunProposal[]};

export function RunView({page, run, proposals = []}: RunViewProps): string {
    const running = run.status === "running";
    const stop = running
        ? `<form method="post" action="/admin/runs/${run.id}/stop" class="actions"><button type="submit">Stop</button></form>`
        : "";
    const finished = running ? "" : summaryList(run.summary);
    return AdminLayout({
        ...page,
        refresh: running ? {seconds: REFRESH_SECONDS, url: `/admin/runs/${run.id}`} : undefined,
        children: `
            <p><a href="/admin/runs">All runs</a></p>
            <h1>${esc(`Run ${run.id}: ${STATUS_LABELS[run.status]}`)}${run.dryRun ? ` <span class="tag">Dry run</span>` : ""}</h1>
            <p class="note">Started ${when(run.startedAt)} by ${esc(startedByText(run.startedBy))}, finished ${run.finishedAt ? when(run.finishedAt) : "not yet"}.</p>
            ${stop}
            ${finished}
            ${running ? "" : proposalList(proposals)}
            <pre class="log">${esc(run.log ?? "")}</pre>`,
    });
}
