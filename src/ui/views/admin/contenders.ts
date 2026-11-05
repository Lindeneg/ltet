import type {Ceo} from "../../../lib/content.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {esc, initials} from "../../lib.js";
import type {AdminPage} from "./page.js";

export type ContendersViewProps = {
    page: AdminPage;
    ceos: Ceo[];
    counts: Map<string, number>;
};

export function Thumb(ceo: Ceo): string {
    return ceo.photo
        ? `<img class="thumb" src="/${esc(ceo.photo.file)}" width="40" height="40" alt="" aria-hidden="true" />`
        : `<span class="thumb crest" aria-hidden="true">${esc(initials(ceo.name))}</span>`;
}

export function ContendersView({page, ceos, counts}: ContendersViewProps): string {
    const rows = ceos
        .map(
            (ceo) => `
                <tr>
                    <td data-label="Photo">${Thumb(ceo)}</td>
                    <td data-label="Name"><a href="/admin/contenders/${esc(encodeURIComponent(ceo.id))}">${esc(ceo.name)}</a></td>
                    <td data-label="Company">${esc(ceo.company)}</td>
                    <td data-label="Statements" class="num">${counts.get(ceo.id) ?? 0}</td>
                </tr>`
        )
        .join("");
    return AdminLayout({
        ...page,
        children: `
            <div class="toolbar">
                <h1>Contenders</h1>
                <a class="button" href="/admin/contenders/new">New contender</a>
            </div>
            <table class="cards">
                <thead><tr><th>Photo</th><th>Name</th><th>Company</th><th>Statements</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`,
    });
}
