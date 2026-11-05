import {esc} from "../../lib.js";
import {AdminLayout, AuthLayout} from "../../components/admin-layout.js";
import type {AdminPage} from "./page.js";

export function ErrorView(message: string, page?: AdminPage): string {
    const children = `<p class="error">${esc(message)}</p>`;
    return page ? AdminLayout({...page, children}) : AuthLayout(children);
}
