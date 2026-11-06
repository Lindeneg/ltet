import {AdminLayout} from "../../components/admin-layout.js";
import {ErrorBox, when} from "../../components/admin-parts.js";
import {esc} from "../../lib.js";
import type {MaybeNull} from "../../../lib/types.js";
import type {TokenStatus} from "../../../services/scout-runner-service.js";
import type {AdminPage} from "./page.js";

export type SettingsViewProps = {
    page: AdminPage;
    passwordErrors?: Record<string, string>;
    passwordTopError?: string;
    passwordChanged?: boolean;
    scoutTime?: string;
    scoutError?: string;
    token?: MaybeNull<TokenStatus>;
    tokenError?: string;
};

function field(name: string, label: string, autocomplete: string, error?: string): string {
    const errorHtml = error ? `<span class="error">${esc(error)}</span>` : "";
    return `<label>${esc(label)} <input name="${name}" type="password" autocomplete="${autocomplete}" required />${errorHtml}</label>`;
}

const UNREADABLE = "The saved token can't be read, since the server's secret changed. Paste it again.";

function tokenSource(token: TokenStatus): string {
    if (token.source === "cms") return `Now from the CMS, set ${when(token.setAt)}.`;
    if (token.source === "env") return "Now from the server's environment.";
    return "None set, so the scout can't log in to Claude.";
}

function TokenSection(token: MaybeNull<TokenStatus>, error?: string): string {
    const status = token ? `<p class="note">${tokenSource(token)}</p>` : "";
    const remove =
        token?.source === "cms" || token?.unreadable
            ? `<form method="post" action="/admin/settings/claude-token/remove">
                    <button class="danger" type="submit">Remove token</button>
                </form>`
            : "";
    return `<section class="card">
                <h2>Claude token</h2>
                <p class="note">The scout logs in to Claude with this token. Paste what <code>claude setup-token</code> prints. It is stored encrypted and never shown again.</p>
                ${status}
                <form method="post" action="/admin/settings/claude-token" class="stack">
                    ${ErrorBox(error ?? (token?.unreadable ? UNREADABLE : undefined))}
                    <label>New token <input name="claudeToken" type="password" autocomplete="off" spellcheck="false" required /></label>
                    <div class="actions"><button type="submit">Save token</button></div>
                </form>
                ${remove}
            </section>`;
}

export function SettingsView({
    page,
    passwordErrors = {},
    passwordTopError,
    passwordChanged,
    scoutTime = "",
    scoutError,
    token = null,
    tokenError,
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
            </section>
            ${TokenSection(token, tokenError)}`,
    });
}
