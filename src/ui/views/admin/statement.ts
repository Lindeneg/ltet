import type {Content} from "../../../lib/content.js";
import type {StatementWithHistory} from "../../../repositories/statement-repository.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {
    ErrorBox,
    NoImplicitSubmit,
    StatementEditor,
    StatementSummary,
    editorValues,
    forksOf,
    when,
    type EditorValues,
} from "../../components/admin-parts.js";
import {esc} from "../../lib.js";
import type {AdminPage} from "./page.js";

export type StatementViewProps = {
    page: AdminPage;
    content: Content;
    row: StatementWithHistory;
    values?: EditorValues;
    note?: string;
    error?: {message: string; errors?: string[]};
};

export function StatementView({page, content, row, values, note = "", error}: StatementViewProps): string {
    const id = encodeURIComponent(row.id);
    const many = content.rubric.unit.many;
    const history =
        row.history.length === 0
            ? `<p class="note">No changes since it went in.</p>`
            : `<ul class="plain history">${row.history
                  .map(
                      (v) => `
                <li>${when(v.changedAt)}${esc(`: ${v.note ?? "changed"} (the version before: ${forksOf(content, v.body)} ${many}${v.published ? "" : ", hidden"}) `)}
                    <a class="button quiet" href="/admin/statements/${esc(id)}?load=${v.id}">Load into the editor</a></li>`
                  )
                  .join("")}</ul>`;
    return AdminLayout({
        ...page,
        children: `
            <p><a href="/admin/statements">All statements</a></p>
            <article class="card">
                <div class="meta">
                    <span class="tag ${row.published ? "good" : "warn"}">${row.published ? "Live" : "Hidden"}</span>
                    <span>${esc(`${row.origin}, updated `)}${when(row.updatedAt)}</span>
                    <a href="/match/${esc(id)}" target="_blank">See it on the site</a>
                </div>
                ${StatementSummary(content, row.body)}
                <form method="post" action="/admin/statements/${esc(id)}">
                    ${NoImplicitSubmit}
                    ${StatementEditor(content, values ?? editorValues(row.body))}
                    ${ErrorBox(error?.message, error?.errors)}
                    <div class="actions">
                        <input type="text" name="note" value="${esc(note)}" placeholder="What changed and why" aria-label="Change note" size="40" />
                        <button type="submit" class="go">Save changes</button>
                        <button type="submit" class="${row.published ? "danger" : "quiet"}" formaction="/admin/statements/${esc(id)}/published" name="published" value="${row.published ? "0" : "1"}">${row.published ? "Hide from the site" : "Show on the site"}</button>
                    </div>
                </form>
            </article>
            <h2>History</h2>
            ${history}`,
    });
}
