import type {Content} from "../../../lib/content.js";
import type {StatementRecord} from "../../../repositories/statement-repository.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {ceoName, forksOf} from "../../components/admin-parts.js";
import {esc} from "../../lib.js";
import type {AdminPage} from "./page.js";

export type StatementsViewProps = {
    page: AdminPage;
    content: Content;
    statements: StatementRecord[];
    q: string;
};

export function searchText(content: Content, row: StatementRecord): string {
    return `${row.id} ${ceoName(content, row.body.ceo)} ${row.body.headline?.text} ${row.body.quote}`.toLowerCase();
}

export function matches(text: string, q: string): boolean {
    return q
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((word) => text.includes(word));
}

export function StatementsView({page, content, statements, q}: StatementsViewProps): string {
    const many = content.rubric.unit.many;
    const rows = statements
        .map((row) => {
            const text = searchText(content, row);
            const hidden = matches(text, q) ? "" : " hidden";
            return `
                <tr${row.published ? "" : ` class="hidden-row"`} data-search="${esc(text)}"${hidden}>
                    <td data-label="Date">${esc(row.body.date)}</td>
                    <td data-label="Contender">${esc(ceoName(content, row.body.ceo))}</td>
                    <td data-label="Headline"><a href="/admin/statements/${esc(encodeURIComponent(row.id))}">${esc(row.body.headline?.text ?? row.id)}</a></td>
                    <td data-label="${esc(many)}" class="num">${forksOf(content, row.body)}</td>
                    <td data-label="On the site">${row.published ? "live" : "hidden"}</td>
                </tr>`;
        })
        .join("");
    return AdminLayout({
        ...page,
        children: `
            <div class="toolbar">
                <h1>Statements (${statements.length})</h1>
                <a class="button quiet" href="/admin/import">Import edits</a>
                <form method="get" action="/admin/statements" role="search">
                    <input type="search" name="q" value="${esc(q)}" placeholder="Search quote, headline, contender" aria-label="Search" data-search-input />
                </form>
            </div>
            <table class="cards">
                <thead><tr><th>Date</th><th>Contender</th><th>Headline</th><th>${esc(many)}</th><th>On the site</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`,
    });
}
