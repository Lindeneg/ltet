import {esc} from "../../lib.js";
import {AuthLayout} from "../../components/admin-layout.js";

export type LoginViewProps = {
    error?: string;
    email?: string;
};

export function LoginView({error, email}: LoginViewProps): string {
    return AuthLayout(`
        <form method="post" action="/admin/login" class="login">
            <h1>Log in</h1>
            <label>Email <input name="email" type="email" value="${esc(email ?? "")}" autocomplete="email" required /></label>
            <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
            <button type="submit">Log in</button>
            <p class="error" role="alert">${esc(error ?? "")}</p>
        </form>`);
}
