import {describe, expect, it} from "vitest";
import {parseSuperUser} from "../../../src/lib/env.js";

describe("parseSuperUser", () => {
    it("stores the email trimmed and in lowercase", () => {
        expect(parseSuperUser(" DEV@Example.com ,Ada,Lovelace,a password, with a comma")).toEqual({
            ok: true,
            data: {email: "dev@example.com", name: "Ada Lovelace", password: "a password, with a comma"},
        });
    });

    it("refuses a blank email", () => {
        expect(parseSuperUser("  ,Ada,Lovelace,secret").ok).toBe(false);
    });
});
