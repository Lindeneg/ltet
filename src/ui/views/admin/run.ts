import type {Content} from "../../../lib/content.js";
import type {MissedOutcome, ProposedOutcome, ResearchedOutcome, RunOutcomes} from "../../../lib/scout.js";
import type {RunProposal, RunRecord} from "../../../repositories/run-repository.js";
import type {ProposalStatus} from "../../../generated/prisma/client.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {ceoName, extLink, when} from "../../components/admin-parts.js";
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

const PROPOSAL_STATUS: Record<ProposalStatus, string> = {
    open: "Open",
    approved: "Approved",
    rejected: "Rejected",
    done: "Done",
};

const MISSED: Record<MissedOutcome["kind"], string> = {
    dropped: "Dropped",
    duplicate: "Duplicate",
    failed: "Failed checks",
};

const inboxHref = (id: number) => `/admin?status=all#proposal-${id}`;

function summaryList(summary: unknown): string {
    if (!summary || typeof summary !== "object") return "";
    const values = summary as Record<string, unknown>;
    const items = SUMMARY.filter(([key]) => values[key] != null)
        .map(([key, label]) => {
            const value = key === "costUsd" ? formatCost(Number(values[key])) : String(values[key]);
            return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
        })
        .join("");
    return items ? `<dl class="summary scoreboard">${items}</dl>` : "";
}

function section(title: string, items: string[]): string {
    if (items.length === 0) return "";
    return `<section class="report"><h2>${esc(title)}</h2>${items.join("")}</section>`;
}

function inboxLink(proposal: RunProposal | undefined, id: number): string {
    const status = proposal ? ` <span class="tag">${esc(PROPOSAL_STATUS[proposal.status])}</span>` : "";
    return `<a href="${inboxHref(id)}">In the inbox</a>${status}`;
}

function proposedCard(content: Content, p: ProposedOutcome, proposals: RunProposal[]): string {
    const reach = p.verified ? `<span class="tag good">Verified</span>` : `<span class="tag warn">On one site</span>`;
    const unit = p.forks === 1 ? content.rubric.unit.one : content.rubric.unit.many;
    const sent =
        p.proposalId === null
            ? `<span class="tag">Not sent to the inbox</span>`
            : inboxLink(
                  proposals.find((row) => row.id === p.proposalId),
                  p.proposalId
              );
    return `<article class="card">
        <h3>${esc(p.headline)}</h3>
        <div class="meta"><span>${esc(ceoName(content, p.ceo))}</span>${reach}<span>${esc(`${p.forks} ${unit}`)}</span><span>${esc(p.statementId)}</span></div>
        <p class="actions">${sent}</p>
    </article>`;
}

function rowCard(proposal: RunProposal): string {
    return `<article class="card">
        <h3>${esc(proposal.statementId ?? `#${proposal.id}`)}</h3>
        <p class="actions">${inboxLink(proposal, proposal.id)}</p>
    </article>`;
}

function missedCard(content: Content, m: MissedOutcome): string {
    const id = m.statementId ? `<span>${esc(m.statementId)}</span>` : "";
    return `<article class="card">
        <div class="meta"><span class="tag">${esc(MISSED[m.kind])}</span><span>${esc(ceoName(content, m.ceo))}</span><span>${esc(m.date)}</span><span>${esc(m.venue)}</span>${id}</div>
        <p class="reason">${esc(m.reason)}</p>
    </article>`;
}

function researchedCard(s: ResearchedOutcome): string {
    const verdict = s.qualifies
        ? `<span class="tag good">Qualifies</span>`
        : `<span class="tag">Does not qualify</span>`;
    const led =
        s.proposalId === null ? "" : ` <a href="${inboxHref(s.proposalId)}">Led to proposal #${s.proposalId}</a>`;
    return `<article class="card">
        <div class="meta"><a href="${inboxHref(s.id)}">Suggestion #${s.id}</a>${verdict}</div>
        <p class="reason">${extLink(s.url)}</p>
        <p class="reason">${esc(s.finding)}${led}</p>
    </article>`;
}

function report(content: Content, outcomes: RunOutcomes, proposals: RunProposal[]): string {
    return [
        section(
            "Proposed",
            outcomes.proposed.map((p) => proposedCard(content, p, proposals))
        ),
        section(
            "Did not make it",
            outcomes.missed.map((m) => missedCard(content, m))
        ),
        section("Suggestions researched", outcomes.suggestions.map(researchedCard)),
    ].join("");
}

function quiet(run: RunRecord): string {
    const leads = (run.summary as {leads?: unknown} | null)?.leads;
    if (run.status !== "ok" || leads !== 0) return "";
    return `<p class="note">A quiet run: the scout found no new leads.</p>`;
}

function lastLine(run: RunRecord): string {
    if (run.status !== "failed" && run.status !== "stopped") return "";
    const line = (run.log ?? "").trimEnd().split("\n").at(-1);
    return line ? `<p class="error">${esc(line)}</p>` : "";
}

export type RunViewProps = {page: AdminPage; content: Content; run: RunRecord; proposals?: RunProposal[]};

export function RunView({page, content, run, proposals = []}: RunViewProps): string {
    const running = run.status === "running";
    const header = `
            <p><a href="/admin/runs">All runs</a></p>
            <h1>${esc(`Run ${run.id}: ${STATUS_LABELS[run.status]}`)}${run.dryRun ? ` <span class="tag">Dry run</span>` : ""}</h1>
            <p class="note">Started ${when(run.startedAt)} by ${esc(startedByText(run.startedBy))}, finished ${run.finishedAt ? when(run.finishedAt) : "not yet"}.</p>`;
    if (running) {
        return AdminLayout({
            ...page,
            refresh: {seconds: REFRESH_SECONDS, url: `/admin/runs/${run.id}`},
            children: `${header}
            <form method="post" action="/admin/runs/${run.id}/stop" class="actions"><button type="submit">Stop</button></form>
            <pre class="log">${esc(run.log ?? "")}</pre>`,
        });
    }
    const body = run.outcomes ? report(content, run.outcomes, proposals) : section("Proposed", proposals.map(rowCard));
    return AdminLayout({
        ...page,
        children: `${header}
            ${lastLine(run)}
            ${summaryList(run.summary)}
            ${quiet(run)}
            ${body}
            <details class="card"><summary>Full log</summary><pre class="log">${esc(run.log ?? "")}</pre></details>`,
    });
}
