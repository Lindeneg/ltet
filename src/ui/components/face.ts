import type {Ceo, Photo} from "../../lib/content.js";
import {attrs, esc, initials} from "../lib.js";

const SHIELD = "M2 2h28v15.5c0 8.4-6 13.6-14 16.5C8 31.1 2 25.9 2 17.5z";

export type FaceSize = "xs" | "sm" | "md" | "lg" | "xl";

const FACE_SIZES: Record<FaceSize, [number, number]> = {
    xs: [24, 27],
    sm: [32, 36],
    md: [44, 50],
    lg: [112, 126],
    xl: [160, 180],
};

function shield(className: string, inner: string): string {
    return `<svg class="${esc(className)}" viewBox="0 0 32 36" aria-hidden="true"><path class="crest-shield" d="${SHIELD}"/>${inner}</svg>`;
}

function crestText(text: string): string {
    return `<text class="crest-text" x="16" y="20.5" text-anchor="middle">${esc(text)}</text>`;
}

export function crest(ceo: Pick<Ceo, "name">, extra = ""): string {
    return shield(`crest ${extra}`.trim(), crestText(initials(ceo.name)));
}

export function allCrest(): string {
    return shield("crest all", crestText("ALL"));
}

export function publicCrest(extra = ""): string {
    return shield(`crest public ${extra}`.trim(), `<use href="#pitchfork" x="8" y="7" width="16" height="16"/>`);
}

export type FaceOpts = {size?: FaceSize; gold?: boolean; eager?: boolean; beside?: boolean};

export function face(ceo: Ceo, {size = "sm", gold = false, eager = false, beside = true}: FaceOpts = {}): string {
    const tone = `${size}${gold ? " gold" : ""}`;
    if (!ceo.photo?.file) return crest(ceo, `face-crest ${tone}`);
    const [width, height] = FACE_SIZES[size];
    const img = attrs({
        class: "face-img",
        alt: ceo.name,
        width,
        height,
        decoding: "async",
        loading: eager ? null : "lazy",
        "aria-hidden": beside ? "true" : null,
        src: `/${ceo.photo.file.replace(/^\/+/, "")}`,
    });
    return `<span class="face ${tone}" data-initials="${esc(initials(ceo.name))}"><img${img}></span>`;
}

function external(url: string, text: string): string {
    return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;
}

export function photoCredit(photo: Photo): string {
    const licence = photo.licenceUrl
        ? external(photo.licenceUrl, photo.licence)
        : esc(/^public domain$/i.test(photo.licence) ? "public domain" : photo.licence);
    return `${esc(photo.author)}, ${licence}, ${esc(photo.changes)}, ${external(photo.source, "source on Wikimedia Commons")}`;
}
