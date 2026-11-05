import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {JSDOM} from "jsdom";
import {describe, expect, it, vi} from "vitest";
import {readSeed} from "../../src/lib/content.js";
import {BASE_URL, db, uid} from "./helpers.js";

const REPORT_SCRIPT = readFileSync(resolve(import.meta.dirname, "../../public/report.js"), "utf8");

async function load(path: string) {
    const html = await (await fetch(BASE_URL + path)).text();
    const {window} = new JSDOM(html, {url: BASE_URL + path, runScripts: "outside-only", pretendToBeVisual: true});
    window.fetch = ((url: string, init: RequestInit) =>
        fetch(new URL(url, BASE_URL), {
            ...init,
            headers: {...(init.headers as Record<string, string>), "sec-fetch-site": "same-origin"},
        })) as typeof window.fetch;
    window.eval(REPORT_SCRIPT);
    return window.document;
}

describe("the feedback dialogs against the api", () => {
    it("files a call for VAR from the match page as a dispute", async () => {
        const [first] = await readSeed();
        const document = await load(`/match/${first.id}`);
        const form = document.querySelector<HTMLFormElement>(".var-form")!;
        const comment = `Too harsh ${uid()}`;
        document.querySelector<HTMLButtonElement>(".var-open")!.click();
        form.querySelector<HTMLInputElement>('input[name="var-count"]')!.checked = true;
        form.querySelector<HTMLInputElement>('input[name="var-direction"][value="fewer"]')!.checked = true;
        form.querySelector<HTMLTextAreaElement>("textarea")!.value = comment;

        form.requestSubmit();

        await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".var-thanks")!.hidden).toBe(false));
        const stored = await db.p.proposal.findFirstOrThrow({where: {kind: "dispute", body: {contains: comment}}});
        expect(stored).toMatchObject({origin: "visitor", statementId: first.id, status: "open"});
        expect(JSON.parse(stored.body)).toMatchObject({direction: "fewer", comment});
    });

    it("files a report from the suggest dialog as a suggestion", async () => {
        const document = await load("/");
        const url = `https://news.example/${uid()}`;
        document.querySelector<HTMLInputElement>("#suggest-url")!.value = url;
        document.querySelector<HTMLSelectElement>("#suggest-ceo")!.value = "musk";
        document.querySelector<HTMLTextAreaElement>("#suggest-quote")!.value = "Some words";

        document.querySelector<HTMLFormElement>("#suggest-form")!.requestSubmit();

        await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#suggest-thanks")!.hidden).toBe(false));
        const stored = await db.p.proposal.findFirstOrThrow({where: {kind: "suggestion", body: {contains: url}}});
        expect(JSON.parse(stored.body)).toEqual({url, ceo: "musk", quote: "Some words", note: ""});
    });

    it("shows the api's own sentence when it refuses a link", async () => {
        const document = await load("/");
        document.querySelector<HTMLInputElement>("#suggest-url")!.value = "not a link";

        document.querySelector<HTMLFormElement>("#suggest-form")!.requestSubmit();

        await vi.waitFor(() =>
            expect(document.querySelector("#suggest-error")!.textContent).toBe(
                "A link to where it was said or reported, please."
            )
        );
    });
});
