import {createCipheriv, randomBytes} from "node:crypto";
import {describe, expect, it} from "vitest";
import {deriveKey, open, seal} from "../../../src/lib/secret-box.js";

const SECRET = "a secret of at least thirty two characters";

describe("secret box", () => {
    const key = deriveKey(SECRET, "claude token");

    it("derives the same 32 byte key from the same secret and purpose, and others from others", () => {
        expect(key).toHaveLength(32);
        expect(deriveKey(SECRET, "claude token").equals(key)).toBe(true);
        expect(deriveKey(SECRET, "something else").equals(key)).toBe(false);
        expect(deriveKey(`${SECRET}!`, "claude token").equals(key)).toBe(false);
    });

    it("opens what it sealed, and seals the same text differently each time", () => {
        const sealed = seal(key, "sk-ant-oat01-token");

        expect(sealed).not.toContain("sk-ant");
        expect(open(key, sealed)).toBe("sk-ant-oat01-token");
        expect(seal(key, "sk-ant-oat01-token")).not.toBe(sealed);
    });

    it("opens nothing under another key", () => {
        expect(open(deriveKey("another secret of at least thirty two chars", "claude token"), seal(key, "x"))).toBe(
            null
        );
    });

    it("opens nothing that was changed, cut short or never sealed", () => {
        const bytes = Buffer.from(seal(key, "sk-ant-oat01-token"), "base64");
        const flipped = Buffer.from(bytes);
        flipped[flipped.length - 1] ^= 1;

        expect(open(key, flipped.toString("base64"))).toBe(null);
        expect(open(key, bytes.subarray(0, bytes.length - 1).toString("base64"))).toBe(null);
        expect(open(key, bytes.subarray(0, 28).toString("base64"))).toBe(null);
        expect(open(key, "")).toBe(null);
        expect(open(key, "not base64 at all")).toBe(null);
    });

    it("refuses a short auth tag", () => {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv, {authTagLength: 4});
        const body = Buffer.concat([cipher.update("sk-ant-oat01-token", "utf8"), cipher.final()]);
        const shortTag = Buffer.concat([iv, cipher.getAuthTag(), Buffer.alloc(12), body]).toString("base64");

        expect(open(key, shortTag)).toBe(null);
    });
});
