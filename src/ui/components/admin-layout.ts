import {VERSION, type Version} from "../../lib/version.js";
import type {MaybeNull} from "../../lib/types.js";
import {esc} from "../lib.js";

const TITLE = "The referee's room | Let Them Eat Tokens";

export type AdminTab = "inbox" | "statements" | "contenders" | "rubric" | "runs" | "settings";

const TABS: Array<{id: AdminTab; href: string; label: string}> = [
    {id: "inbox", href: "/admin", label: "Inbox"},
    {id: "statements", href: "/admin/statements", label: "Statements"},
    {id: "contenders", href: "/admin/contenders", label: "Contenders"},
    {id: "rubric", href: "/admin/rubric", label: "Rubric"},
    {id: "runs", href: "/admin/runs", label: "Scout runs"},
    {id: "settings", href: "/admin/settings", label: "Settings"},
];

const COMMIT_URL = "https://github.com/Lindeneg/ltet/commit/";

export function versionLine(version: MaybeNull<Version>): string {
    if (!version) return "Version dev";
    const date = version.date.slice(0, 16).replace("T", " ");
    const link = `<a href="${esc(COMMIT_URL + version.sha)}">${esc(version.sha.slice(0, 7))}</a>`;
    return `Version ${link}${version.dirty ? "-dirty" : ""} · ${esc(date)} UTC`;
}

export type Refresh = {seconds: number; url: string};

function document(bar: string, main: string, refresh?: Refresh): string {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />${refresh ? `\n    <meta http-equiv="refresh" content="${esc(`${refresh.seconds}; url=${refresh.url}`)}" />` : ""}
    <title>${esc(TITLE)}</title>
    <link rel="icon" href="/assets/pitchfork.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/admin.css" />
    <script src="/admin.js" defer></script>
</head>
<body>
    <header class="bar">
        <a class="brand" href="/" title="The site">Let Them Eat Tokens</a>
        <span class="room">The referee's room</span>
        ${bar}
    </header>
    <main>${main}</main>
    <footer class="version">${versionLine(VERSION)}</footer>
</body>
</html>`;
}

export type AdminLayoutProps = {
    tab?: AdminTab;
    open: number;
    toast?: string;
    refresh?: Refresh;
    children: string;
};

export function AdminLayout({tab, open, toast, refresh, children}: AdminLayoutProps): string {
    const badge = open > 0 ? ` <span class="badge">${open}</span>` : "";
    const tabs = TABS.map((t) => {
        const current = t.id === tab ? ` aria-current="page"` : "";
        return `<a href="${t.href}"${current}>${esc(t.label)}${t.id === "inbox" ? badge : ""}</a>`;
    }).join("");
    const bar = `
        <nav class="tabs">${tabs}</nav>
        <form method="post" action="/admin/logout" class="logout">
            <button class="quiet" type="submit">Log out</button>
        </form>`;
    const toastHtml = toast ? `<div class="toast" role="status">${esc(toast)}</div>` : "";
    return document(bar, `${children}${toastHtml}`, refresh);
}

export function AuthLayout(children: string): string {
    return document("", children);
}
