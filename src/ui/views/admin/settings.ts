import {AdminLayout} from "../../components/admin-layout.js";
import {ErrorBox} from "../../components/admin-parts.js";
import {esc} from "../../lib.js";
import type {AdminPage} from "./page.js";

export type SettingsViewProps = {
    page: AdminPage;
    passwordErrors?: Record<string, string>;
    passwordTopError?: string;
    passwordChanged?: boolean;
    scoutTime?: string;
    scoutError?: string;
};

function field(name: string, label: string, autocomplete: string, error?: string): string {
    const errorHtml = error ? `<span class="error">${esc(error)}</span>` : "";
    return `<label>${esc(label)} <input name="${name}" type="password" autocomplete="${autocomplete}" required />${errorHtml}</label>`;
}

export function SettingsView({
    page,
    passwordErrors = {},
    passwordTopError,
    passwordChanged,
    scoutTime = "",
    scoutError,
}: SettingsViewProps): string {
    const changed = passwordChanged ? `<p class="success" role="status">Password changed</p>` : "";
    return AdminLayout({
        ...page,
        children: `
            <div class="toolbar"><h1>Settings</h1></div>
            <section class="card">
                <h2>Password</h2>
                <p class="note">Changing it signs out every other session.</p>
                <form method="post" action="/admin/settings/password" class="stack">
                    ${ErrorBox(passwordTopError)}
                    ${changed}
                    ${field("currentPassword", "Current password", "current-password", passwordErrors.currentPassword)}
                    ${field("newPassword", "New password", "new-password", passwordErrors.newPassword)}
                    ${field("confirmPassword", "Confirm new password", "new-password", passwordErrors.confirmPassword)}
                    <div class="actions"><button type="submit">Change password</button></div>
                </form>
            </section>
            <section class="card">
                <h2>Scout</h2>
                <p class="note">The server starts the scout once a day at this time, in production only. A time missed while the server was down is skipped.</p>
                <form method="post" action="/admin/settings/scout" class="stack">
                    ${ErrorBox(scoutError)}
                    <label>Daily run (UTC) <input name="scoutTime" type="time" value="${esc(scoutTime)}" required /></label>
                    <div class="actions"><button type="submit">Save time</button></div>
                </form>
            </section>`,
    });
}
