import {describe, expect, it} from "vitest";
import {InboxView} from "../../../src/ui/views/admin/inbox.js";
import {esc} from "../../../src/ui/lib.js";
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
        counts: {statement: 2},
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

    const view = (props: Partial<Parameters<typeof InboxView>[0]>) =>
        InboxView({page, content: makeContent(), items: [], counts: {}, kind: "all", status: "open", ...props});

    it("has one empty page when there are no proposals", () => {
        const empty = view({});

        expect(empty).toContain("Nothing here.");
        expect(empty).toContain("Everything (0)");
        expect(empty).not.toContain(`aria-label="Pages"`);
    });

    it("counts every kind across pages", () => {
        const counted = view({counts: {statement: 40, suggestion: 25, dispute: 3}, pageNo: 2, pages: 2});

        expect(counted).toContain("Everything (68)");
        expect(counted).toContain("Proposed statements (40)");
        expect(counted).toContain(esc("Visitors' suggestions (25)"));
        expect(counted).toContain("Score disputes (3)");
    });

    it("links the chips and the closed toggle to the first page", () => {
        const second = view({pageNo: 2, pages: 3});

        expect(second).toContain(`href="/admin?kind=dispute"`);
        expect(second).toContain(`href="/admin?status=all"`);
    });

    it("shows only Older on the first page and only Newer on the last", () => {
        expect(view({pageNo: 1, pages: 2})).toContain(`<a class="button quiet" href="/admin?page=2">Older</a>`);
        expect(view({pageNo: 1, pages: 2})).not.toContain("Newer");
        expect(view({pageNo: 2, pages: 2})).toContain(`<a class="button quiet" href="/admin">Newer</a>`);
        expect(view({pageNo: 2, pages: 2})).not.toContain("Older");
    });

    it("carries the page through a card's decision", () => {
        const card = view({
            items: [{...makeProposal({id: 1}), statement: null}],
            counts: {statement: 51},
            pageNo: 2,
            pages: 2,
        });

        expect(card).toContain(`<input type="hidden" name="page" value="2" />`);
    });

    it("says a dispute's statement is gone", () => {
        const gone = view({
            items: [{...makeProposal({id: 5, kind: "dispute", statementId: "gone-1", body: {}}), statement: null}],
            counts: {dispute: 1},
        });

        expect(gone).toContain("(statement gone-1 is gone)");
    });
});

describe("the runs", () => {
    const content = makeContent();

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
        expect(RunView({page, content, run: makeRun({summary: {costUsd: 0.3}}), proposals: []})).toContain(
            "<dd>$0.30</dd>"
        );
    });
});

describe("a run's report", () => {
    const content = makeContent();
    const empty = {proposed: [], missed: [], suggestions: []};
    const proposed = {
        statementId: "altman-dishes",
        ceo: "altman",
        headline: "Robots <b>for</b> dishes",
        verified: true,
        foundOn: 2,
        forks: 5,
        proposalId: 42,
    };
    const counts = {since: "2026-10-01", leads: 0, proposed: 0, dropped: 0, failed: 0, costUsd: 0.2};

    it("shows a quiet run as done with an empty report, not an error", () => {
        const html = RunView({page, content, run: makeRun({summary: counts, outcomes: empty})});

        expect(html).toContain("Run 1: Done");
        expect(html).toContain("A quiet run: the scout found no new leads.");
        expect(html).not.toContain(`class="error"`);
        expect(html).not.toContain(`class="report"`);
    });

    it("renders a failed run without summary or outcomes, its last line up top", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({status: "failed", summary: null, log: "Started.\nFailed: <x>"}),
        });

        expect(html).toContain(`<p class="error">Failed: &lt;x&gt;</p>`);
        expect(html).not.toContain("scoreboard");
        expect(html).not.toContain("A quiet run");
    });

    it("renders a run without outcomes from its log, as the server marks a run that died", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({status: "failed", summary: null, log: "Scout run 1.\nThe scout ended without finishing."}),
        });

        expect(html).toContain(`<p class="error">The scout ended without finishing.</p>`);
        expect(html).toContain(`<details class="card"><summary>Full log</summary>`);
    });

    it("shows a stopped run's partial report", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({status: "stopped", log: "Stopped.", outcomes: {...empty, proposed: [proposed]}}),
            proposals: [{id: 42, statementId: "altman-dishes", status: "open", newer: 0}],
        });

        expect(html).toContain(`<p class="error">Stopped.</p>`);
        expect(html).toContain("<h2>Proposed</h2>");
    });

    it("shows the proposals as cards with their contender, reach and inbox link", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({
                outcomes: {...empty, proposed: [proposed, {...proposed, verified: false, proposalId: 43, forks: 1}]},
            }),
            proposals: [
                {id: 42, statementId: "altman-dishes", status: "open", newer: 0},
                {id: 43, statementId: "altman-dishes-2", status: "approved", newer: 0},
            ],
        });

        expect(html).toContain("<h3>Robots &lt;b&gt;for&lt;/b&gt; dishes</h3>");
        expect(html).toContain("<span>Sam Altman</span>");
        expect(html).toContain(`<span class="tag good">Verified</span>`);
        expect(html).toContain(`<span class="tag warn">On one site</span>`);
        expect(html).toContain("<span>5 pitchforks</span>");
        expect(html).toContain("<span>1 pitchfork</span>");
        expect(html).toContain(
            `<a href="/admin?status=all#proposal-42">In the inbox</a> <span class="tag">Open</span>`
        );
    });

    it("links a proposal on a later page to its page", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({outcomes: {...empty, proposed: [proposed]}}),
            proposals: [{id: 42, statementId: "altman-dishes", status: "open", newer: 50}],
        });

        expect(html).toContain(`<a href="/admin?status=all&amp;page=2#proposal-42">In the inbox</a>`);
    });

    it("keeps a proposal 49 newer ones down on the first page", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({outcomes: {...empty, proposed: [proposed]}}),
            proposals: [{id: 42, statementId: "altman-dishes", status: "open", newer: 49}],
        });

        expect(html).toContain(`<a href="/admin?status=all#proposal-42">In the inbox</a>`);
    });

    it("links a decided proposal into the inbox's all view with its status", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({outcomes: {...empty, proposed: [proposed]}}),
            proposals: [{id: 42, statementId: "altman-dishes", status: "rejected", newer: 0}],
        });

        expect(html).toContain(
            `<a href="/admin?status=all#proposal-42">In the inbox</a> <span class="tag">Rejected</span>`
        );
    });

    it("marks a dry run's proposals as not sent to the inbox, with no inbox link", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({dryRun: true, outcomes: {...empty, proposed: [{...proposed, proposalId: null}]}}),
        });

        expect(html).toContain(`<span class="tag">Not sent to the inbox</span>`);
        expect(html).not.toContain("In the inbox");
    });

    it("falls back to the proposal rows and the summary for a run from before the outcomes", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({outcomes: null}),
            proposals: [{id: 42, statementId: "altman-dishes", status: "done", newer: 0}],
        });

        expect(html).toContain(`<dl class="summary scoreboard">`);
        expect(html).toContain("<h3>altman-dishes</h3>");
        expect(html).toContain(`<span class="tag">Done</span>`);
        expect(html).not.toContain("Did not make it");
    });

    it("escapes every reason, finding and log line", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({
                log: "<img src=x>",
                outcomes: {
                    proposed: [],
                    missed: [
                        {
                            kind: "failed",
                            ceo: "<musk>",
                            date: "2026-10-01",
                            venue: "<venue>",
                            statementId: "<id>",
                            reason: "<script>reason</script>",
                        },
                    ],
                    suggestions: [
                        {
                            id: 5,
                            url: "javascript:alert(1)",
                            qualifies: false,
                            finding: "<b>finding</b>",
                            proposalId: null,
                        },
                    ],
                },
            }),
        });

        for (const raw of ["<script>reason", "<img", "<b>finding", "<musk>", "<venue>", "<id>"]) {
            expect(html).not.toContain(raw);
        }
        expect(html).toContain("&lt;script&gt;reason&lt;/script&gt;");
        expect(html).toContain("&lt;b&gt;finding&lt;/b&gt;");
        expect(html).toContain("&lt;img src=x&gt;");
        expect(html).not.toContain(`href="javascript`);
    });

    it("lists what did not make it and every suggestion researched", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({
                outcomes: {
                    proposed: [],
                    missed: [
                        {
                            kind: "dropped",
                            ceo: "musk",
                            date: "2026-10-01",
                            venue: "X",
                            statementId: null,
                            reason: "Politics.",
                        },
                        {
                            kind: "duplicate",
                            ceo: "musk",
                            date: "2026-10-02",
                            venue: "X",
                            statementId: "a",
                            reason: "repeats b",
                        },
                    ],
                    suggestions: [
                        {id: 5, url: "https://news.example/a", qualifies: true, finding: "Real.", proposalId: 42},
                        {id: 6, url: "https://news.example/b", qualifies: false, finding: "Old.", proposalId: null},
                    ],
                },
            }),
        });

        expect(html).toContain("<h2>Did not make it</h2>");
        expect(html).toContain(`<span class="tag">Dropped</span><span>Elon Musk</span>`);
        expect(html).toContain(`<span class="tag">Duplicate</span>`);
        expect(html).toContain("<h2>Suggestions researched</h2>");
        expect(html).toContain(
            `<a href="/admin?status=all#proposal-5">Suggestion #5</a><span class="tag good">Qualifies</span>`
        );
        expect(html).toContain(`<span class="tag">Does not qualify</span>`);
        expect(html).toContain(`<a href="/admin?status=all#proposal-42">Led to proposal #42</a>`);
    });

    it("keeps the live log, refresh and Stop for a running run, with no report", () => {
        const html = RunView({
            page,
            content,
            run: makeRun({status: "running", finishedAt: null, summary: null, log: "Started.", outcomes: empty}),
        });

        expect(html).toContain(`action="/admin/runs/1/stop"`);
        expect(html).toContain(`<pre class="log">Started.</pre>`);
        expect(html).not.toContain("Full log");
        expect(html).not.toContain("A quiet run");
    });
});
