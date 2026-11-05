import {describe, expect, it} from "vitest";
import PageCacheService from "../../../src/services/page-cache-service.js";

describe("PageCacheService", () => {
    it("stores and returns entries until cleared", () => {
        const cache = new PageCacheService(10);
        expect(cache.get("a")).toBeUndefined();
        cache.set("a", "<p>a</p>");
        cache.set("b", "<p>b</p>");
        expect(cache.get("a")).toBe("<p>a</p>");

        cache.clear();

        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBeUndefined();
    });

    it("evicts the least recently used entry when full", () => {
        const cache = new PageCacheService(2);
        cache.set("a", "a");
        cache.set("b", "b");
        cache.set("c", "c");

        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBe("b");
        expect(cache.get("c")).toBe("c");
    });

    it("refreshes recency on a hit", () => {
        const cache = new PageCacheService(2);
        cache.set("a", "a");
        cache.set("b", "b");
        cache.get("a");
        cache.set("c", "c");

        expect(cache.get("a")).toBe("a");
        expect(cache.get("b")).toBeUndefined();
    });

    it("overwrites an existing key without growing", () => {
        const cache = new PageCacheService(2);
        cache.set("a", "old");
        cache.set("a", "new");
        cache.set("b", "b");

        expect(cache.get("a")).toBe("new");
        expect(cache.get("b")).toBe("b");
    });
});
