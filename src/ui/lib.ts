import type {DatePrecision} from "../lib/content.js";

export function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

type AttrValue = string | number | boolean | null | undefined;

export function attrs(values: Record<string, AttrValue>): string {
    return Object.entries(values)
        .filter(([, value]) => value !== false && value !== null && value !== undefined)
        .map(([key, value]) => (value === true ? ` ${key}` : ` ${key}="${esc(String(value))}"`))
        .join("");
}

// the csp forbids style attributes, so widths are classes from /widths.css in tenths of a percent
export function widthClass(fraction: number): string {
    return `w-${Math.round(Math.min(1, Math.max(0, fraction)) * 1000)}`;
}

export function initials(name: string): string {
    return name
        .split(/\s+/)
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

export function count(n: number): string {
    return n.toLocaleString("en-GB");
}

export function matches(n: number): string {
    return `${count(n)} ${n === 1 ? "match" : "matches"}`;
}

export function ordinal(n: number): string {
    const suffix = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return `${n}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`;
}

export function sentence(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export function list(names: string[]): string {
    return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", {...options, timeZone: "UTC"});

export const dayFormat = utc({day: "numeric", month: "long", year: "numeric"});
export const monthFormat = utc({month: "long", year: "numeric"});
const weekdayFormat = utc({weekday: "short"});
const shortDayFormat = utc({day: "numeric", month: "short", year: "numeric"});
const dayMonthFormat = utc({day: "numeric", month: "short"});
const longDayMonthFormat = utc({day: "numeric", month: "long"});
const shortMonthFormat = utc({month: "short", year: "numeric"});

type Dated = {date: string; datePrecision: DatePrecision};

const dayOf = (date: string) => new Date(`${date}T00:00:00Z`);

export function formatDate({date, datePrecision}: Dated): string {
    const time = dayOf(date);
    if (datePrecision === "month") return monthFormat.format(time);
    if (datePrecision === "reported") return `reported ${dayFormat.format(time)}`;
    return dayFormat.format(time);
}

export function dayThisYear(time: number, now: number): string {
    const sameYear = new Date(time).getUTCFullYear() === new Date(now).getUTCFullYear();
    return (sameYear ? longDayMonthFormat : dayFormat).format(time);
}

export function cardDate({date, datePrecision}: Dated): string {
    const time = dayOf(date);
    if (datePrecision === "month") return shortMonthFormat.format(time);
    if (datePrecision === "reported") return `Reported ${shortDayFormat.format(time)}`;
    return `${weekdayFormat.format(time)} ${shortDayFormat.format(time)}`;
}

export function tickDate({date, datePrecision}: Dated): string {
    const time = dayOf(date);
    return datePrecision === "month" ? shortMonthFormat.format(time) : dayMonthFormat.format(time);
}
