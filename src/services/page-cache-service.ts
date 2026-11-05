import type {MaybeUndefined} from "../lib/types.js";

class PageCacheService {
    // a map iterates in insertion order, so the first key is always the least recently used
    readonly #entries = new Map<string, string>();

    constructor(private readonly maxEntries: number) {}

    get(key: string): MaybeUndefined<string> {
        const html = this.#entries.get(key);
        if (html === undefined) return undefined;
        this.#entries.delete(key);
        this.#entries.set(key, html);
        return html;
    }

    set(key: string, html: string): void {
        this.#entries.delete(key);
        this.#entries.set(key, html);
        while (this.#entries.size > this.maxEntries) {
            const oldest = this.#entries.keys().next().value;
            if (oldest === undefined) break;
            this.#entries.delete(oldest);
        }
    }

    clear(): void {
        this.#entries.clear();
    }
}

export default PageCacheService;
