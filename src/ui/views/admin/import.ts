import type {ImportPlan, ImportReady, ImportSkip} from "../../../lib/statement-import.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {ErrorBox} from "../../components/admin-parts.js";
import {esc} from "../../lib.js";
import type {AdminPage} from "./page.js";

export type ImportViewProps = {page: AdminPage; text?: string; error?: string; plan?: ImportPlan; applied?: boolean};

const FORMAT = `{"edits": [{"id": "<statement id>", "set": {"<path>": {"from": <current value>, "to": <new value>}}}]}`;

const json = (value: unknown) => `<code>${esc(JSON.stringify(value))}</code>`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const statementLink = (id: string) => `<a href="/admin/statements/${esc(encodeURIComponent(id))}">${esc(id)}</a>`;

function Ready(item: ImportReady): string {
    const rows = item.changes
        .map(
            (change) => `
                <tr>
                    <td data-label="Path"><code>${esc(change.path)}</code></td>
                    <td data-label="Before">${json(change.from)}</td>
                    <td data-label="After">${json(change.to)}</td>
                </tr>`
        )
        .join("");
    return `
        <article class="card">
            <h2>${esc(item.body.headline?.text ?? item.id)}</h2>
            <div class="meta">${statementLink(item.id)}</div>
            <table class="cards">
                <thead><tr><th>Path</th><th>Before</th><th>After</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </article>`;
}

function Skipped(items: ImportSkip[]): string {
    if (items.length === 0) return "";
    const list = items
        .map(
            (item) => `
                <li>${statementLink(item.id)}<ul class="plain">${item.reasons
                    .map((r) => `<li>${r.path ? `<code>${esc(r.path)}</code> ` : ""}${esc(r.reason)}</li>`)
                    .join("")}</ul></li>`
        )
        .join("");
    return `
        <h2>Skipped</h2>
        <section class="card">
            <p class="note">These statements are left as they are.</p>
            <ul class="plain">${list}</ul>
        </section>`;
}

function Unchanged(ids: string[]): string {
    if (ids.length === 0) return "";
    return `
        <h2>Unchanged</h2>
        <section class="card">
            <p class="note">Every edit already matches.</p>
            <ul class="plain">${ids.map((id) => `<li>${statementLink(id)}</li>`).join("")}</ul>
        </section>`;
}

function EditForm(text: string, error?: string): string {
    return `
        <form method="post" action="/admin/import/preview" class="card stack import">
            <p class="note">Paste a JSON file of edits. Preview shows every change and every skipped edit, and nothing is written until you apply.</p>
            <pre class="log">${esc(FORMAT)}</pre>
            <p class="note">A path is a dotted path into the statement, like <code>venue</code>, <code>backlash.summary</code> or <code>scores.tone-deafness.score</code>. It must exist already, and <code>from</code> must match the live value. A statement with any skipped edit is left as it is. At most 500 edits and 2 MB.</p>
            ${ErrorBox(error)}
            <label>Edits (JSON) <textarea name="edits" rows="14" spellcheck="false" required>${esc(text)}</textarea></label>
            <div class="actions"><button type="submit">Preview</button></div>
        </form>`;
}

function Preview(plan: ImportPlan, text: string): string {
    const n = plan.ready.length;
    const summary = `${plural(n, "statement", "statements")} will change, ${plan.skipped.length} skipped, ${plan.unchanged.length} unchanged.`;
    const apply =
        n > 0
            ? `<form method="post" action="/admin/import/apply" class="actions">
                    <input type="hidden" name="edits" value="${esc(text)}" />
                    <button type="submit" class="go">Apply to ${plural(n, "statement", "statements")}</button>
                </form>`
            : `<p class="note">Nothing to apply.</p>`;
    return `
        <p>${esc(summary)}</p>
        ${apply}
        ${n > 0 ? `<h2>Will change</h2>${plan.ready.map(Ready).join("")}` : ""}
        ${Skipped(plan.skipped)}
        ${Unchanged(plan.unchanged)}
        <h2>Edit and preview again</h2>
        ${EditForm(text)}`;
}

function Applied(plan: ImportPlan): string {
    return `
        <p>${esc(`Applied to ${plural(plan.ready.length, "statement", "statements")}.`)}</p>
        ${plan.ready.length > 0 ? `<h2>Changed</h2>${plan.ready.map(Ready).join("")}` : ""}
        ${Skipped(plan.skipped)}
        ${Unchanged(plan.unchanged)}`;
}

export function ImportView({page, text = "", error, plan, applied}: ImportViewProps): string {
    const body = plan ? (applied ? Applied(plan) : Preview(plan, text)) : EditForm(text, error);
    return AdminLayout({
        ...page,
        children: `
            <p><a href="/admin/statements">All statements</a></p>
            <div class="toolbar"><h1>Import edits</h1></div>
            ${body}`,
    });
}
