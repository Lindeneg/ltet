import {readFileSync} from "node:fs";
import {resolve} from "node:path";

export function runScript(name: string): void {
    const source = readFileSync(resolve(import.meta.dirname, "../../../public", name), "utf8");
    new Function(source)();
    if (document.readyState === "loading") document.dispatchEvent(new Event("DOMContentLoaded"));
}
