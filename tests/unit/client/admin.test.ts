// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {AdminLayout} from "../../../src/ui/components/admin-layout.js";
import {StatementEditor, editorValues, when} from "../../../src/ui/components/admin-parts.js";
import {StatementsView} from "../../../src/ui/views/admin/statements.js";
import {makeContent, makeStatement, makeStatementRecord} from "../helpers.js";
import {runScript} from "./run-script.js";

// the views reach paths.ts through content.ts, and its file urls don't resolve under jsdom
vi.mock("../../../src/lib/paths.js", () => ({}));

function mount(html: string) {
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    runScript("admin.js");
}

const page = {open: 0};

describe("admin.js", () => {
    const tz = process.env.TZ;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        process.env.TZ = tz;
        document.body.innerHTML = "";
    });

    describe("the live total", () => {
        function mountEditor() {
            const content = makeContent();
            mount(
                AdminLayout({
                    ...page,
                    children: `<form>${StatementEditor(content, editorValues(makeStatement()))}</form>`,
                })
            );
        }
        const total = () => document.querySelector("[data-total]")!.textContent;
        const type = (selector: string, value: string) => {
            const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
            field.value = value;
            field.dispatchEvent(new Event("input", {bubbles: true}));
        };

        it("starts with the server's total", () => {
            mountEditor();

            expect(total()).toBe("5 pitchforks");
        });

        it("follows the scores as they change, weighted", () => {
            mountEditor();

            type("[name=score_doom]", "4");
            expect(total()).toBe("11 pitchforks");

            type("[name=score_loss]", "0");
            expect(total()).toBe("8 pitchforks");
        });

        it("is blank while the json does not parse, and back once it does", () => {
            mountEditor();
            const json = document.querySelector<HTMLTextAreaElement>("[name=json]")!.value;

            type("[name=json]", "{broken");
            expect(total()).toBe("");

            type("[name=json]", json);
            expect(total()).toBe("5 pitchforks");
        });
    });

    describe("the toast", () => {
        it("fades after two and a half seconds", () => {
            mount(AdminLayout({...page, toast: "Saved.", children: ""}));
            expect(document.querySelector(".toast")!.textContent).toBe("Saved.");

            vi.advanceTimersByTime(2499);
            expect(document.querySelector(".toast")).not.toBeNull();

            vi.advanceTimersByTime(1);
            expect(document.querySelector(".toast")).toBeNull();
        });
    });

    describe("the dates", () => {
        it("are rewritten in the owner's own timezone", () => {
            process.env.TZ = "Asia/Kolkata";
            const date = new Date("2025-09-01T12:00:00Z");
            mount(AdminLayout({...page, children: `<p>${when(date)}</p>`}));

            expect(document.querySelector("time")!.textContent).toBe("1 Sept 2025, 17:30");
            expect(document.querySelector("time")!.getAttribute("datetime")).toBe(date.toISOString());
        });

        it("leave a time they can't read as the server wrote it", () => {
            mount(`<time datetime="nonsense" data-local>as written</time>`);

            expect(document.querySelector("time")!.textContent).toBe("as written");
        });
    });

    describe("the live search", () => {
        function mountList(q = "") {
            const content = makeContent();
            const statements = [
                makeStatementRecord(),
                makeStatementRecord({
                    id: "musk-2025-01-01-other",
                    body: makeStatement({id: "musk-2025-01-01-other", ceo: "musk", quote: "Other words"}),
                }),
            ];
            mount(StatementsView({page, content, statements, q}));
        }
        const shown = () =>
            [...document.querySelectorAll<HTMLTableRowElement>("tr[data-search]")]
                .filter((row) => !row.hidden)
                .map((row) => row.dataset.search!.split(" ")[0]);
        const search = (value: string) => {
            const input = document.querySelector<HTMLInputElement>("[data-search-input]")!;
            input.value = value;
            input.dispatchEvent(new Event("input"));
        };

        it("hides the rows that don't have every word", () => {
            mountList();

            search("ELON other");
            expect(shown()).toEqual(["musk-2025-01-01-other"]);

            search("altman nothing");
            expect(shown()).toEqual([]);
        });

        it("shows every row again when the search is cleared", () => {
            mountList("elon");
            expect(shown()).toEqual(["musk-2025-01-01-other"]);

            search("  ");
            expect(shown()).toEqual(["altman-2025-09-01-statement", "musk-2025-01-01-other"]);
        });
    });
});
