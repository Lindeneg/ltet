import type {Ceo} from "../../../lib/content.js";
import type {Blockers} from "../../../services/content-service.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {ErrorBox} from "../../components/admin-parts.js";
import {attrs, esc} from "../../lib.js";
import type {AdminPage} from "./page.js";
import {Thumb} from "./contenders.js";

export const CONTENDER_FIELDS = [
    "id",
    "name",
    "company",
    "photoAuthor",
    "photoLicence",
    "photoLicenceUrl",
    "photoSource",
    "photoChanges",
] as const;

export type ContenderValues = Record<(typeof CONTENDER_FIELDS)[number], string>;

export type ContenderViewProps = {
    page: AdminPage;
    values: ContenderValues;
    errors?: Record<string, string>;
    topError?: string;
    existing?: {ceo: Ceo; blockers: Blockers};
};

export function contenderValues(ceo?: Ceo, fields?: Partial<ContenderValues>): ContenderValues {
    return {
        id: ceo?.id ?? "",
        name: ceo?.name ?? "",
        company: ceo?.company ?? "",
        photoAuthor: ceo?.photo?.author ?? "",
        photoLicence: ceo?.photo?.licence ?? "",
        photoLicenceUrl: ceo?.photo?.licenceUrl ?? "",
        photoSource: ceo?.photo?.source ?? "",
        photoChanges: ceo?.photo?.changes ?? "",
        ...fields,
    };
}

function field(name: keyof ContenderValues, label: string, values: ContenderValues, errors: Record<string, string>) {
    const error = errors[name] ? `<span class="error">${esc(errors[name])}</span>` : "";
    return `<label>${esc(label)} <input${attrs({name, type: "text", value: values[name]})} />${error}</label>`;
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function DeleteSection(id: string, {statements, proposals}: Blockers): string {
    if (statements > 0 || proposals > 0) {
        const parts = [
            statements > 0 ? counted(statements, "statement", "statements") : "",
            proposals > 0 ? counted(proposals, "open proposal", "open proposals") : "",
        ].filter(Boolean);
        return `<p class="note">Has ${esc(parts.join(" and "))}, so it can't be deleted.</p>`;
    }
    return `<form method="post" action="/admin/contenders/${esc(encodeURIComponent(id))}/delete">
                <button class="danger" type="submit">Delete contender</button>
            </form>`;
}

export function ContenderView({page, values, errors = {}, topError, existing}: ContenderViewProps): string {
    const action = existing ? `/admin/contenders/${encodeURIComponent(existing.ceo.id)}` : "/admin/contenders";
    const id = existing
        ? `<p><strong>Id</strong> ${esc(existing.ceo.id)}</p>`
        : field("id", "Id (can't be changed later)", values, errors);
    const current = existing ? Thumb(existing.ceo) : "";
    const remove = existing?.ceo.photo
        ? `<label class="check"><input type="checkbox" name="removePhoto" value="1" /> Remove the photo</label>`
        : "";
    const photoError = errors.photo ? `<span class="error">${esc(errors.photo)}</span>` : "";
    return AdminLayout({
        ...page,
        children: `
            <div class="toolbar"><h1>${esc(existing ? existing.ceo.name : "New contender")}</h1></div>
            <section class="card">
                <form method="post" action="${esc(action)}" enctype="multipart/form-data" class="stack">
                    ${ErrorBox(topError)}
                    ${id}
                    ${field("name", "Name", values, errors)}
                    ${field("company", "Company", values, errors)}
                    ${current}
                    ${field("photoAuthor", "Photo author", values, errors)}
                    ${field("photoLicence", "Licence", values, errors)}
                    ${field("photoLicenceUrl", "Licence URL", values, errors)}
                    ${field("photoSource", "Source", values, errors)}
                    ${field("photoChanges", "Changes", values, errors)}
                    ${remove}
                    <label>Photo (JPEG, at most 2 MB) <input type="file" name="photo" accept="image/jpeg" />${photoError}</label>
                    <div class="actions"><button type="submit">${existing ? "Save" : "Add contender"}</button></div>
                </form>
            </section>
            ${existing ? `<section class="card">${DeleteSection(existing.ceo.id, existing.blockers)}</section>` : ""}`,
    });
}
