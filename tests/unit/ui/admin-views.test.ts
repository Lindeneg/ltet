import {describe, expect, it} from "vitest";
import {InboxView} from "../../../src/ui/views/admin/inbox.js";
import {RunView} from "../../../src/ui/views/admin/run.js";
import {RunsView} from "../../../src/ui/views/admin/runs.js";
import {SettingsView} from "../../../src/ui/views/admin/settings.js";
import {StatementsView} from "../../../src/ui/views/admin/statements.js";
import {makeContent, makeProposal, makeRun, makeStatement, makeStatementRecord} from "../helpers.js";

const page = {open: 0};

const tableClasses = (html: string) => [...html.matchAll(/<table class="([^"]*)"/g)].map((m) => m[1].split(" "));

describe("the cms's tables", () => {
    it("stack as cards on a phone without the forms' grid class", () => {
        const tables = [
            ...tableClasses(StatementsView({page, content: makeContent(), statements: [makeStatementRecord()], q: ""})),
            ...tableClasses(RunsView({page, runs: [makeRun()]})),
        ];

        expect(tables).toHaveLength(2);
        for (const classes of tables) {
            expect(classes).toContain("cards");
            expect(classes).not.toContain("stack");
        }
    });

    it("leave the forms' grid class on the settings form", () => {
        expect(SettingsView({page})).toContain(`class="stack"`);
    });
});

describe("the inbox", () => {
    const html = InboxView({
        page,
        content: makeContent(),
        items: [
            {...makeProposal({id: 1}), statement: null},
            {
                ...makeProposal({id: 2, body: makeStatement({id: "musk-2025-09-02-other", ceo: "musk"})}),
                statement: null,
            },
        ],
        kind: "all",
        status: "open",
    });

    it("has no id twice with two proposed statements", () => {
        const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);

        expect(ids).toContain("score_1_loss");
        expect(ids).toContain("score_2_loss");
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("points every label at a field that exists", () => {
        const ids = new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
        const targets = [...html.matchAll(/<label for="([^"]*)"/g)].map((m) => m[1]);

        expect(targets.length).toBeGreaterThan(0);
        for (const target of targets) expect(ids.has(target), target).toBe(true);
    });

    it("keeps the score fields' names, which the form posts", () => {
        expect(html.match(/name="score_loss"/g)).toHaveLength(2);
    });
});

describe("the runs", () => {
    it("keep a dry run's tag beside the status, the since date whole and the cost in cents", () => {
        const html = RunsView({
            page,
            runs: [{...makeRun({summary: {since: "2026-08-20", costUsd: 0.3}}), dryRun: true}],
        });

        expect(html).toContain(`<td data-label="Status"><span>Done <span class="tag">Dry run</span></span></td>`);
        expect(html).toContain(`<td data-label="Since"><span class="nowrap">2026-08-20</span></td>`);
        expect(html).toContain(`<td data-label="Cost estimate" class="num">$0.30</td>`);
    });

    it("show the cost in cents on a run's page", () => {
        expect(RunView({page, run: makeRun({summary: {costUsd: 0.3}}), proposals: []})).toContain("<dd>$0.30</dd>");
    });
});
