import type {Content} from "../../../lib/content.js";
import type {KindCounts} from "../../../repositories/proposal-repository.js";
import type {InboxItem, InboxStatus} from "../../../services/proposal-service.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {
    ErrorBox,
    StatementEditor,
    StatementSummary,
    categoryName,
    ceoName,
    editorValues,
    extLink,
    when,
    NoImplicitSubmit,
    type Checks,
    type EditorValues,
} from "../../components/admin-parts.js";
import {esc} from "../../lib.js";
import type {AdminPage} from "./page.js";

export const KINDS = [
    {id: "all", label: "Everything"},
    {id: "statement", label: "Proposed statements"},
    {id: "suggestion", label: "Visitors' suggestions"},
    {id: "dispute", label: "Score disputes"},
] as const;

export type InboxKind = (typeof KINDS)[number]["id"];

export type CardError = {message: string; errors?: string[]; values?: EditorValues; note?: string};

export type InboxViewProps = {
    page: AdminPage;
    content: Content;
    items: InboxItem[];
    counts: KindCounts;
    kind: InboxKind;
    status: InboxStatus;
    pageNo?: number;
    pages?: number;
    failed?: {id: number} & CardError;
};

export function inboxHref(kind: InboxKind, status: InboxStatus, page = 1): string {
    const params = new URLSearchParams();
    if (kind !== "all") params.set("kind", kind);
    if (status !== "open") params.set("status", status);
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return query ? `/admin?${query}` : "/admin";
}

type Suggestion = {url?: string; ceo?: string; quote?: string; note?: string};
type SuggestionChecks = {qualifies?: boolean; finding?: string};
type Dispute = {category?: string; direction?: string; comment?: string};

function closeControls(item: InboxItem, view: Pick<InboxViewProps, "kind" | "status" | "pageNo">, note = ""): string {
    const action = `/admin/proposals/${item.id}/close`;
    return `
        <input type="hidden" name="kind" value="${esc(view.kind)}" />
        <input type="hidden" name="view" value="${esc(view.status)}" />
        <input type="hidden" name="page" value="${view.pageNo ?? 1}" />
        <input type="text" name="note" value="${esc(note)}" placeholder="Reason (optional)" title="The scout reads the reasons for rejected statements" aria-label="Reason" size="40" />
        <button type="submit" class="quiet" formaction="${action}" name="status" value="done">Close as done</button>
        <button type="submit" class="danger" formaction="${action}" name="status" value="rejected">Reject</button>`;
}

function head(item: InboxItem): string {
    const run = item.runId ? `<a href="/admin/runs/${item.runId}">run ${item.runId}</a>` : "";
    const closed =
        item.status === "open"
            ? ""
            : `<span class="tag ${item.status === "approved" ? "good" : ""}">${esc(`${item.status}${item.note ? `: ${item.note}` : ""}`)}</span>`;
    return `
        <div class="meta">
            <span class="tag">${esc(item.kind)}</span>
            <span>#${item.id}, ${esc(item.origin)}, ${when(item.createdAt)}</span>
            ${run}${closed}
        </div>`;
}

function card(item: InboxItem, props: InboxViewProps): string {
    const {content} = props;
    const open = item.status === "open";
    const failed = props.failed?.id === item.id ? props.failed : undefined;
    const errors = ErrorBox(failed?.message, failed?.errors);
    const form = (inner: string) =>
        open
            ? `<form method="post" action="/admin/proposals/${item.id}/close">${NoImplicitSubmit}${inner}</form>`
            : inner;

    if (item.kind === "statement") {
        const body = item.body as Parameters<typeof editorValues>[0];
        const editor = StatementEditor(content, failed?.values ?? editorValues(body), `${item.id}_`);
        const inner = `
            ${head(item)}
            ${StatementSummary(content, body, item.checks as Checks)}
            ${open ? editor : ""}
            ${errors}
            ${
                open
                    ? `<div class="actions">
                        <button type="submit" class="go" formaction="/admin/proposals/${item.id}/approve">Approve and publish</button>
                        ${closeControls(item, props, failed?.note)}
                      </div>`
                    : ""
            }`;
        return `<article class="card" id="proposal-${item.id}">${form(inner)}</article>`;
    }

    if (item.kind === "suggestion") {
        const b = item.body as Suggestion;
        const checks = item.checks as SuggestionChecks | null;
        const scout = checks
            ? `<p><span class="tag ${checks.qualifies ? "good" : "warn"}">${checks.qualifies ? "Scout: qualifies" : "Scout: does not qualify"}</span>${esc(` ${checks.finding ?? ""}`)}</p>`
            : `<p class="note">The scout researches it on its next run.</p>`;
        const inner = `
            ${head(item)}
            <h2>${extLink(b.url)}</h2>
            <div class="meta"><span>${esc(b.ceo ? `About ${ceoName(content, b.ceo)}` : "No contender named")}</span></div>
            ${b.quote ? `<blockquote>${esc(b.quote)}</blockquote>` : ""}
            ${b.note ? `<p>${esc(b.note)}</p>` : ""}
            ${scout}
            ${errors}
            ${open ? `<div class="actions">${closeControls(item, props, failed?.note)}</div>` : ""}`;
        return `<article class="card" id="proposal-${item.id}">${form(inner)}</article>`;
    }

    const b = item.body as Dispute;
    const s = item.statement;
    const href = `/admin/statements/${encodeURIComponent(item.statementId ?? "")}`;
    const current = b.category ? s?.scores?.[b.category] : undefined;
    const title = s
        ? `<a href="${esc(href)}">${esc(s.headline.text)}</a>`
        : esc(`(statement ${item.statementId} is gone)`);
    const inner = `
        ${head(item)}
        <h2>${title}</h2>
        <p><strong>${esc(`${categoryName(content, b.category)}: `)}</strong>${esc(
            `scored ${current?.score ?? "?"} ("${current?.reason ?? ""}"); a visitor wants ${b.direction === "more" ? "more" : "fewer"} pitchforks.`
        )}</p>
        ${b.comment ? `<blockquote>${esc(b.comment)}</blockquote>` : ""}
        ${errors}
        ${
            open
                ? `<div class="actions"><a href="${esc(href)}" class="note">Open the statement to change its score</a>${closeControls(item, props, failed?.note)}</div>`
                : ""
        }`;
    return `<article class="card" id="proposal-${item.id}">${form(inner)}</article>`;
}

function pager(kind: InboxKind, status: InboxStatus, pageNo: number, pages: number): string {
    if (pages <= 1) return "";
    const newer = pageNo > 1 ? `<a class="button quiet" href="${inboxHref(kind, status, pageNo - 1)}">Newer</a>` : "";
    const older =
        pageNo < pages ? `<a class="button quiet" href="${inboxHref(kind, status, pageNo + 1)}">Older</a>` : "";
    return `<nav class="actions pager" aria-label="Pages">${newer}${older}</nav>`;
}

export function InboxView(props: InboxViewProps): string {
    const {items: shown, kind, status, pageNo = 1, pages = 1} = props;
    const total = Object.values(props.counts).reduce((sum, n) => sum + (n ?? 0), 0);
    const counts = Object.fromEntries(KINDS.map((k) => [k.id, k.id === "all" ? total : (props.counts[k.id] ?? 0)]));
    const failed = props.failed;
    const lost = failed && !shown.some((p) => p.id === failed.id) ? ErrorBox(failed.message, failed.errors) : "";
    const chips = KINDS.map((k) => {
        const current = k.id === kind ? ` aria-current="true"` : "";
        return `<a class="chip" href="${inboxHref(k.id, status)}"${current}>${esc(`${k.label} (${counts[k.id]})`)}</a>`;
    }).join("");
    const empty =
        shown.length === 0
            ? `<p class="empty">Nothing here. The scout runs daily; visitors write when they write.</p>`
            : "";
    return AdminLayout({
        ...props.page,
        children: `
            <div class="toolbar">
                <h1>${status === "open" ? "Waiting for you" : "Everything, closed too"}</h1>
                <a class="button quiet" href="${inboxHref(kind, status === "open" ? "all" : "open")}">${status === "open" ? "Show closed too" : "Show open only"}</a>
            </div>
            <nav class="chips toolbar" aria-label="Kind">${chips}</nav>
            ${lost}
            ${empty}
            ${shown.map((item) => card(item, props)).join("")}
            ${pager(kind, status, pageNo, pages)}`,
    });
}
