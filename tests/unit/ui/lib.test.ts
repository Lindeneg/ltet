import {describe, expect, it} from "vitest";
import {
    attrs,
    cardDate,
    dayThisYear,
    esc,
    formatDate,
    list,
    matches,
    ordinal,
    tickDate,
    widthClass,
} from "../../../src/ui/lib.js";

describe("esc", () => {
    it("escapes every character that could break out of text or an attribute", () => {
        expect(esc(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
            "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;"
        );
    });
});

describe("attrs", () => {
    it("leaves out false, null and undefined, writes true bare and escapes the rest", () => {
        expect(attrs({a: 'x"y', b: 2, c: true, d: false, e: null, f: undefined})).toBe(' a="x&quot;y" b="2" c');
    });
});

describe("widthClass", () => {
    it.each([
        [0, "w-0"],
        [0.2354, "w-235"],
        [0.2356, "w-236"],
        [1, "w-1000"],
        [-0.5, "w-0"],
        [3, "w-1000"],
    ])("gives %s the class %s", (fraction, cls) => {
        expect(widthClass(fraction)).toBe(cls);
    });
});

describe("words and numbers", () => {
    it("counts matches", () => {
        expect(matches(1)).toBe("1 match");
        expect(matches(1234)).toBe("1,234 matches");
    });

    it.each([
        [1, "1st"],
        [2, "2nd"],
        [3, "3rd"],
        [4, "4th"],
        [11, "11th"],
        [12, "12th"],
        [13, "13th"],
        [21, "21st"],
        [102, "102nd"],
    ])("orders %s as %s", (n, text) => {
        expect(ordinal(n)).toBe(text);
    });

    it("lists names with and before the last", () => {
        expect(list([])).toBe("");
        expect(list(["A"])).toBe("A");
        expect(list(["A", "B"])).toBe("A and B");
        expect(list(["A", "B", "C"])).toBe("A, B and C");
    });
});

describe("dates", () => {
    const day = {date: "2025-09-01", datePrecision: "day" as const};
    const month = {date: "2025-09-01", datePrecision: "month" as const};
    const reported = {date: "2025-09-01", datePrecision: "reported" as const};

    it("formats a statement's date by its precision", () => {
        expect(formatDate(day)).toBe("1 September 2025");
        expect(formatDate(month)).toBe("September 2025");
        expect(formatDate(reported)).toBe("reported 1 September 2025");
    });

    it("formats a card's date with the weekday", () => {
        expect(cardDate(day)).toBe("Mon 1 Sept 2025");
        expect(cardDate(month)).toBe("Sept 2025");
        expect(cardDate(reported)).toBe("Reported 1 Sept 2025");
    });

    it("formats the ticker's short date", () => {
        expect(tickDate(day)).toBe("1 Sept");
        expect(tickDate(month)).toBe("Sept 2025");
    });

    it("leaves the year out of a day in the current year", () => {
        const now = Date.UTC(2026, 10, 15, 12);

        expect(dayThisYear(Date.UTC(2026, 9, 30), now)).toBe("30 October");
        expect(dayThisYear(Date.UTC(2025, 11, 30), now)).toBe("30 December 2025");
    });
});
