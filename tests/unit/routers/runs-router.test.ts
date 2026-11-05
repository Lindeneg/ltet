import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import {runsRouter} from "../../../src/routers/admin/runs.js";
import type RunService from "../../../src/services/run-service.js";
import type ScoutRunnerService from "../../../src/services/scout-runner-service.js";
import {StartError} from "../../../src/services/scout-runner-service.js";
import {fake, makeRun} from "../helpers.js";
import {fakeProposalService, serveAdmin} from "./admin-app.js";

describe("runs router", () => {
    let page: Mock;
    let get: Mock;
    let proposals: Mock;
    let start: Mock;
    let stop: Mock;
    let nextRun: Mock;
    let app: Awaited<ReturnType<typeof serveAdmin>>;

    beforeEach(async () => {
        page = vi.fn().mockResolvedValue(success({runs: [makeRun()], page: 1, pages: 1}));
        get = vi.fn().mockResolvedValue(success(makeRun({log: "<script>x</script>"})));
        proposals = vi.fn().mockResolvedValue(success([{id: 42, statementId: "altman-dishes"}]));
        start = vi.fn().mockResolvedValue(success(8));
        stop = vi.fn().mockResolvedValue(success(undefined));
        nextRun = vi.fn().mockReturnValue(new Date("2026-11-02T06:00:00Z"));
        app = await serveAdmin(
            runsRouter(
                fake<RunService>({page, get, proposals}),
                fakeProposalService().service,
                fake<ScoutRunnerService>({start, stop, nextRun})
            )
        );
    });

    afterEach(() => app.close());

    it("lists the runs with their summaries, who started them and the next run", async () => {
        const html = await (await app.get("/admin/runs")).text();

        expect(page).toHaveBeenCalledWith(1);
        expect(html).toContain(`href="/admin/runs/1"`);
        expect(html).toContain("$0.42");
        expect(html).toContain("2025-08-31");
        expect(html).toContain(">Schedule<");
        expect(html).toContain(">Done<");
        expect(html).toContain(`aria-current="page">Scout runs`);
        expect(html).toContain(`Next run: <time datetime="2026-11-02T06:00:00.000Z">2 Nov 2026, 06:00</time> UTC`);
        expect(html).toContain(`<button type="submit">Run the scout</button>`);
        expect(html).not.toContain("Newer");
    });

    it("says when nothing is scheduled", async () => {
        nextRun.mockReturnValue(null);

        expect(await (await app.get("/admin/runs")).text()).toContain(
            "Next run: none, the schedule runs only in production."
        );
    });

    it("says when the scout hasn't run", async () => {
        page.mockResolvedValue(success({runs: [], page: 1, pages: 1}));

        expect(await (await app.get("/admin/runs")).text()).toContain("The scout has not run yet.");
    });

    it("pages through the runs with Newer and Older links", async () => {
        page.mockResolvedValue(success({runs: [makeRun()], page: 2, pages: 3}));

        const html = await (await app.get("/admin/runs?page=2")).text();

        expect(page).toHaveBeenCalledWith(2);
        expect(html).toContain(`<a class="button quiet" href="/admin/runs">Newer</a>`);
        expect(html).toContain(`<a class="button quiet" href="/admin/runs?page=3">Older</a>`);
    });

    it("answers 404 for a page that isn't a number or is past the end", async () => {
        for (const path of ["/admin/runs?page=0", "/admin/runs?page=x", "/admin/runs?page="]) {
            expect((await app.get(path)).status, path).toBe(404);
        }
        page.mockResolvedValue(failure(AppError.NOT_FOUND));
        expect((await app.get("/admin/runs?page=9")).status).toBe(404);
    });

    it("starts a run as the admin and goes to it", async () => {
        const res = await app.post("/admin/runs", {since: "2026-10-01", dryRun: "1"});

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/admin/runs/8?done=started");
        expect(start).toHaveBeenCalledWith({startedBy: "admin@example.com", since: "2026-10-01", dryRun: true});
    });

    it("starts a run with no since and no dry run", async () => {
        await app.post("/admin/runs", {since: ""});

        expect(start).toHaveBeenCalledWith({startedBy: "admin@example.com", since: undefined, dryRun: false});
    });

    it("refuses a since date that is malformed, before the record or after today", async () => {
        for (const since of ["2026-1-1", "2026-02-30", "2022-11-29", "2999-01-01"]) {
            const res = await app.post("/admin/runs", {since});
            expect(res.status, since).toBe(400);
            expect(await res.text()).toContain("Use a date from 2022-11-30 to today, as YYYY-MM-DD.");
        }
        expect(start).not.toHaveBeenCalled();
    });

    it("refuses while a run is going", async () => {
        start.mockResolvedValue(failure(StartError.BUSY));

        const res = await app.post("/admin/runs", {since: ""});

        expect(res.status).toBe(409);
        expect(await res.text()).toContain("A run is already going.");
    });

    it("says when the scout failed to start", async () => {
        start.mockResolvedValue(failure(StartError.NOT_STARTED));

        const res = await app.post("/admin/runs", {since: ""});

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("The scout failed to start.");
    });

    it("shows a finished run with its log escaped, its summary and its proposals", async () => {
        const res = await app.get("/admin/runs/1");

        expect(get).toHaveBeenCalledWith(1);
        expect(proposals).toHaveBeenCalledWith(1);
        const html = await res.text();
        expect(html).toContain("Run 1: Done");
        expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
        expect(html).toContain("<dt>Since</dt><dd>2025-08-31</dd>");
        expect(html).toContain(`<a href="/admin?status=all#proposal-42">#42 altman-dishes</a>`);
        expect(html).not.toContain("http-equiv");
        expect(html).not.toContain(">Stop<");
    });

    it("refreshes a running run every 5 seconds and offers to stop it", async () => {
        get.mockResolvedValue(success(makeRun({id: 8, status: "running", finishedAt: null, dryRun: true})));

        const html = await (await app.get("/admin/runs/8?done=started")).text();

        expect(html).toContain(`<meta http-equiv="refresh" content="5; url=/admin/runs/8" />`);
        expect(html).toContain(`action="/admin/runs/8/stop"`);
        expect(html).toContain("Run 8: Running");
        expect(html).toContain(`<span class="tag">Dry run</span>`);
        expect(html).toContain("Started.");
    });

    it("stops a run and goes back to it", async () => {
        const res = await app.post("/admin/runs/8/stop", {});

        expect(stop).toHaveBeenCalledWith(8);
        expect(res.headers.get("location")).toBe("/admin/runs/8?done=stopped");
    });

    it("answers 404 for a missing run or a path that isn't a number", async () => {
        get.mockResolvedValue(failure(AppError.NOT_FOUND));
        stop.mockResolvedValue(failure(AppError.NOT_FOUND));

        for (const path of ["/admin/runs/7", "/admin/runs/x", "/admin/runs/1.5"]) {
            const res = await app.get(path);
            expect(res.status, path).toBe(404);
            expect(await res.text()).toContain("No run with that number.");
        }
        expect((await app.post("/admin/runs/7/stop", {})).status).toBe(404);
        expect((await app.post("/admin/runs/x/stop", {})).status).toBe(404);
    });

    it("answers a database failure with a 500", async () => {
        page.mockResolvedValue(failure(AppError.DB_ERROR));

        expect((await app.get("/admin/runs")).status).toBe(500);
    });
});
