export function isUrl(value: unknown): boolean {
    if (typeof value !== "string" || !URL.canParse(value)) return false;
    const {protocol} = new URL(value);
    return protocol === "https:" || protocol === "http:";
}
