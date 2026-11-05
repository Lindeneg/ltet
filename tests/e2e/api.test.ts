import {describe, expect, it} from "vitest";
import {readSeed} from "../../src/lib/content.js";
import {BASE_URL, db, uid} from "./helpers.js";

// every request here shares one address, so this file takes fewer than the 10 an hour it may send
const post = (path: string, body: unknown, headers: Record<string, string> = {"sec-fetch-site": "same-origin"}) =>
    fetch(`${BASE_URL}/api${path}`, {
        method: "POST",
        headers: {"content-type": "application/json", ...headers},
        body: JSON.stringify(body),
    });

describe("feedback api", () => {
    it("puts a dispute in the owner's inbox", async () => {
        const [first] = await readSeed();
        const comment = `Too harsh ${uid()}`;

        const res = await post("/dispute", {statementId: first.id, category: "doom", direction: "fewer", comment});

        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ok: true});
        const stored = await db.p.proposal.findFirstOrThrow({where: {kind: "dispute", body: {contains: comment}}});
        expect(stored).toMatchObject({origin: "visitor", statementId: first.id, status: "open"});
        expect(JSON.parse(stored.body)).toEqual({category: "doom", direction: "fewer", comment});
    });

    it("puts a suggestion in the owner's inbox", async () => {
        const url = `https://news.example/${uid()}`;

        const res = await post("/suggest", {url, ceo: "altman", quote: "words", note: ""});

        expect(res.status).toBe(202);
        const stored = await db.p.proposal.findFirstOrThrow({where: {kind: "suggestion", body: {contains: url}}});
        expect(JSON.parse(stored.body)).toEqual({url, ceo: "altman", quote: "words", note: ""});
    });

    it("answers a mistake with a sentence to show", async () => {
        const res = await post("/dispute", {statementId: "nobody", category: "doom", direction: "more"});

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({error: "No such statement."});
    });

    it("refuses feedback from another site", async () => {
        const res = await post("/suggest", {url: "https://news.example/x"}, {"sec-fetch-site": "cross-site"});

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({error: "Send it from the site."});
    });

    it("keeps nothing a bot sends through the hidden field", async () => {
        const url = `https://spam.example/${uid()}`;

        const res = await post("/suggest", {url, website: "https://spam.example"});

        expect(res.status).toBe(202);
        expect(await db.p.proposal.findFirst({where: {body: {contains: url}}})).toBeNull();
    });

    it("keeps 400 for malformed json", async () => {
        const res = await fetch(`${BASE_URL}/api/suggest`, {
            method: "POST",
            headers: {"content-type": "application/json", "sec-fetch-site": "same-origin"},
            body: "{nope",
        });

        expect(res.status).toBe(400);
    });
});
