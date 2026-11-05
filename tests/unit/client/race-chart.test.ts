// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {tally} from "../../../src/lib/score.js";
import {buildSnapshots} from "../../../src/lib/snapshots.js";
import {RaceChart} from "../../../src/ui/components/race-chart.js";
import {makeContent, makeStatement} from "../helpers.js";
import {runScript} from "./run-script.js";

const CONTENDERS = [
    {id: "altman", shortName: "Altman"},
    {id: "musk", shortName: "Musk"},
];

function mount() {
    const {ceos, rubric} = makeContent();
    const statements = [
        makeStatement(),
        makeStatement({id: "musk-2025-10-02-statement", ceo: "musk", date: "2025-10-02"}),
    ];
    const snapshots = buildSnapshots(tally(ceos, rubric, statements).standings, {
        from: Date.UTC(2025, 7, 1),
        to: Date.UTC(2025, 9, 15),
    });
    const chips = CONTENDERS.map(
        (c) => `<button type="button" class="chip" data-follow="${c.id}" aria-pressed="${c.id === "altman"}"></button>`
    ).join("");
    document.body.innerHTML =
        chips +
        RaceChart({snapshots, contenders: CONTENDERS, activeId: "altman", label: "The race", rankLabel: "Follow"});
    runScript("race-chart.js");
}

const frame = () => document.querySelector<HTMLElement>(".race-frame")!;
const tooltip = () => document.querySelector<HTMLElement>(".tooltip")!;
const key = (name: string) => frame().dispatchEvent(new KeyboardEvent("keydown", {key: name, bubbles: true}));

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
        }
    );
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
});

describe("race chart", () => {
    it("follows a contender from its chip in every band and draws it on top", () => {
        mount();

        document.querySelector<HTMLElement>('[data-follow="musk"]')!.click();

        const active = [...document.querySelectorAll<SVGElement>(".series.active")].map((g) => g.dataset.id);
        expect(active).toEqual(["musk", "musk", "musk", "musk"]);
        expect(document.querySelector('[data-follow="musk"]')!.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelector('[data-follow="altman"]')!.getAttribute("aria-pressed")).toBe("false");
        expect((document.querySelector(".race-lines")!.lastElementChild as SVGElement).dataset.id).toBe("musk");
    });

    it("follows a contender from the ranked list and presses his chip and his list entry", () => {
        mount();

        document.querySelector<HTMLElement>('.race-rank [data-follow="musk"]')!.click();

        const pressed = (id: string) =>
            [...document.querySelectorAll(`[data-follow="${id}"]`)].map((b) => b.getAttribute("aria-pressed"));
        expect(pressed("musk")).toEqual(["true", "true"]);
        expect(pressed("altman")).toEqual(["false", "false"]);
        expect(document.querySelector<SVGElement>(".series.active")!.dataset.id).toBe("musk");
    });

    it("walks the months with the arrow keys and shows every total with what the month added", () => {
        mount();

        key("End");
        expect(tooltip().hidden).toBe(false);
        expect(tooltip().querySelector("strong")!.textContent).toBe("October 2025, so far");
        key("ArrowLeft");

        expect(tooltip().querySelector("strong")!.textContent).toBe("End of September 2025");
        const rows = [...tooltip().querySelectorAll(".row:not(.head)")].map((row) =>
            [...row.children].map((cell) => cell.textContent)
        );
        expect(rows).toEqual([
            ["1", "Altman", "5", "+5"],
            ["", "Musk", "0", ""],
        ]);
        expect(tooltip().querySelector(".row.active")!.textContent).toContain("Altman");
        expect(document.querySelector(".crosshair")!.getAttribute("x1")).toBe("50%");
    });

    it("hides the tooltip on escape", () => {
        mount();
        key("Home");

        key("Escape");

        expect(tooltip().hidden).toBe(true);
        expect(document.querySelector(".crosshair")!.getAttribute("visibility")).toBe("hidden");
    });

    it("marks a hovered line that isn't followed", () => {
        mount();
        const musk = document.querySelector<SVGElement>('.race-wide .race-lines .series[data-id="musk"]')!;

        musk.dispatchEvent(new Event("pointerenter"));

        expect([...document.querySelectorAll<SVGElement>(".series.hover")].map((g) => g.dataset.id)).toEqual([
            "musk",
            "musk",
            "musk",
            "musk",
        ]);
    });
});
