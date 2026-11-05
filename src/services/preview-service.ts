import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import {join} from "node:path";
import {Resvg} from "@resvg/resvg-js";
import satori, {type Font, type FontWeight, type FontStyle} from "satori";
import type {MaybeNull} from "../lib/types.js";
import {maxPitchforks, points, type Contender, type ScoredStatement, type Standing} from "../lib/score.js";
import type ContentService from "./content-service.js";
import type LoggerService from "./logger-service.js";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const LONG_HEADLINE = 80;
const BAR_WIDTH = 1072;
const TABLE_ROWS = 5;

const BG = "#0a0e13";
const SURFACE = "#111821";
const SURFACE_3 = "#1f2a37";
const LINE = "#243140";
const INK = "#f1f4f7";
const INK_2 = "#c5ced8";
const MUTED = "#94a1af";
const ACCENT = "#c8f03c";
const ON_ACCENT = "#0a0e13";
const GOLD = "#f2c14e";
const ON_GOLD = "#1b1405";
const RING = "#4f627a";
const CATEGORY_COLOURS: Record<string, string> = {
    loss: "#e5534f",
    condescension: "#3f83e8",
    "tone-deafness": "#b8800a",
    doom: "#8f6fe6",
    hypocrisy: "#1aa37a",
};

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const SHIELD = "M3 3h34v20c0 10.5-7.6 17-17 20.5C10.6 40 3 33.5 3 23z";
const FORK = "M20 17v19M12.5 9v5.5a4 4 0 0 0 4 4h7a4 4 0 0 0 4-4V9M20 9v9.5";
const LEAGUE_CREST = svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 46"><path d="${SHIELD}" fill="${BG}" stroke="${ACCENT}" stroke-width="2.5" stroke-linejoin="round"/><path d="${FORK}" fill="none" stroke="${ACCENT}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
);
const plainShield = (stroke: string) =>
    svgUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 46"><path d="${SHIELD}" fill="${SURFACE_3}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/></svg>`
    );
const initials = (name: string) =>
    name
        .split(/\s+/)
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

const dayFormat = new Intl.DateTimeFormat("en-GB", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"});

type Style = Record<string, string | number>;
type Child = Node | string | null;
type Node = {
    type: string;
    props: {style?: Style; children?: Child | Child[]; src?: string; width?: number; height?: number};
};
type SatoriElement = Parameters<typeof satori>[0];

// satori takes react like element objects, and every element with more than one child needs display flex
const el = (type: string, style: Style, ...children: Child[]): Node => ({
    type,
    props: {style, children: children.length === 1 ? children[0] : children},
});
const img = (src: string, width: number, height = width, style: Style = {}): Node => ({
    type: "img",
    props: {src, width, height, style: {width, height, ...style}},
});

const jpegUri = (data: Buffer) => `data:image/jpeg;base64,${data.toString("base64")}`;

const require = createRequire(import.meta.url);
const fontFile = (pkg: string, file: string) => readFile(require.resolve(`${pkg}/files/${file}`));
const barlow = async (weight: FontWeight, style: FontStyle = "normal"): Promise<Font> => ({
    name: "Barlow Condensed",
    data: await fontFile("@fontsource/barlow-condensed", `barlow-condensed-latin-${weight}-${style}.woff2`),
    weight,
    style,
});
const inter = async (weight: FontWeight): Promise<Font> => ({
    name: "Inter",
    data: await fontFile("@fontsource/inter", `inter-latin-${weight}-normal.woff2`),
    weight,
    style: "normal",
});

export type SiteCard = {standings: Standing[]; statements: ScoredStatement[]};

class PreviewService {
    readonly #images = new Map<string, Promise<Buffer>>();
    readonly #photos = new Map<string, Promise<MaybeNull<string>>>();
    #fonts: MaybeNull<Promise<Font[]>> = null;

    constructor(
        private readonly content: ContentService,
        private readonly photoDir: string,
        private readonly log: LoggerService
    ) {}

    siteCard(key: string, card: () => SiteCard): Promise<Buffer> {
        return this.#cached(`site-${key}`, async () => this.#drawSiteCard(card()));
    }

    statementCard(statement: ScoredStatement): Promise<Buffer> {
        return this.#cached(statement.id, () => this.#drawStatementCard(statement));
    }

    async canDraw(photo: Buffer): Promise<boolean> {
        try {
            await this.#render(img(jpegUri(photo), 64), 64, 64);
            return true;
        } catch {
            return false;
        }
    }

    clear(): void {
        this.#images.clear();
        this.#photos.clear();
    }

    #cached(key: string, draw: () => Promise<Buffer>): Promise<Buffer> {
        let image = this.#images.get(key);
        if (!image) {
            image = draw().catch((error) => {
                this.#images.delete(key);
                throw error;
            });
            this.#images.set(key, image);
        }
        return image;
    }

    #loadFonts(): Promise<Font[]> {
        this.#fonts ??= Promise.all([
            barlow(600),
            barlow(700),
            barlow(800),
            barlow(800, "italic"),
            inter(400),
            inter(600),
        ]);
        return this.#fonts;
    }

    async #render(tree: Node, width = OG_WIDTH, height = OG_HEIGHT): Promise<Buffer> {
        const svg = await satori(tree as unknown as SatoriElement, {
            width,
            height,
            fonts: await this.#loadFonts(),
        });
        return new Resvg(svg, {fitTo: {mode: "original"}, font: {loadSystemFonts: false}}).render().asPng();
    }

    #photoFor(id: string): Promise<MaybeNull<string>> {
        let photo = this.#photos.get(id);
        if (!photo) {
            const file = join(this.photoDir, `${id}.jpg`);
            photo = existsSync(file) ? this.#readPhoto(id, file) : Promise.resolve(null);
            this.#photos.set(id, photo);
        }
        return photo;
    }

    async #readPhoto(id: string, file: string): Promise<MaybeNull<string>> {
        const data = await readFile(file);
        if (await this.canDraw(data)) return jpegUri(data);
        this.log.error({contender: id}, "preview-service.readPhoto cannot draw the photo, drawing the crest");
        return null;
    }

    async #crest(ceo: Contender, size: number, {stroke = RING, photoSize = size * 1.1} = {}): Promise<Node> {
        const photo = await this.#photoFor(ceo.id);
        if (photo) {
            return el(
                "div",
                {display: "flex", width: photoSize, height: photoSize},
                img(photo, photoSize, photoSize, {
                    borderRadius: photoSize,
                    border: `3px solid ${stroke}`,
                    objectFit: "cover",
                })
            );
        }
        return el(
            "div",
            {
                display: "flex",
                position: "relative",
                width: size,
                height: size * 1.15,
                alignItems: "center",
                justifyContent: "center",
            },
            img(plainShield(stroke), size, size * 1.15),
            el(
                "span",
                {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: size,
                    height: size,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "Barlow Condensed",
                    fontWeight: 700,
                    fontSize: size * 0.4,
                    color: INK,
                },
                initials(ceo.name)
            )
        );
    }

    #frame(...children: Child[]): Node {
        return el(
            "div",
            {
                width: OG_WIDTH,
                height: OG_HEIGHT,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                padding: "44px 64px 48px",
                backgroundColor: BG,
                backgroundImage: `linear-gradient(135deg, ${SURFACE} 0%, ${BG} 60%)`,
                color: INK,
                fontFamily: "Inter",
                borderTop: `10px solid ${ACCENT}`,
            },
            ...children
        );
    }

    #masthead(tag: string): Node {
        return el(
            "div",
            {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingBottom: 22,
                borderBottom: `2px solid ${LINE}`,
            },
            el(
                "div",
                {display: "flex", alignItems: "center", gap: 16},
                img(LEAGUE_CREST, 44, 51),
                el(
                    "div",
                    {display: "flex", flexDirection: "column"},
                    el("span", {fontSize: 15, fontWeight: 600, letterSpacing: 3, color: MUTED}, "THE BACKLASH LEAGUE"),
                    el(
                        "span",
                        {
                            fontFamily: "Barlow Condensed",
                            fontWeight: 800,
                            fontStyle: "italic",
                            fontSize: 38,
                            lineHeight: 1,
                        },
                        "LET THEM EAT TOKENS"
                    )
                )
            ),
            el(
                "span",
                {
                    fontFamily: "Barlow Condensed",
                    fontWeight: 700,
                    fontSize: 24,
                    letterSpacing: 2,
                    padding: "6px 16px",
                    backgroundColor: ACCENT,
                    color: ON_ACCENT,
                },
                tag
            )
        );
    }

    async #drawStatementCard(s: ScoredStatement): Promise<Buffer> {
        const max = maxPitchforks(this.content.get().rubric);
        const date = dayFormat.format(new Date(s.time));
        const segments = this.content
            .get()
            .rubric.categories.map((c) => ({
                colour: CATEGORY_COLOURS[c.id] ?? MUTED,
                width: Math.round((points(s, c) / max) * BAR_WIDTH),
            }))
            .filter((segment) => segment.width > 0);
        const team = (crest: Node, name: string, sub: string) =>
            el(
                "div",
                {display: "flex", alignItems: "center", gap: 18, width: 400},
                crest,
                el(
                    "div",
                    {display: "flex", flexDirection: "column"},
                    el(
                        "span",
                        {
                            fontFamily: "Barlow Condensed",
                            fontWeight: 800,
                            fontSize: 44,
                            lineHeight: 1,
                            textTransform: "uppercase",
                        },
                        name
                    ),
                    el("span", {fontSize: 20, color: MUTED, marginTop: 4}, sub)
                )
            );

        return this.#render(
            this.#frame(
                this.#masthead(s.leaked ? "LEAKED · MATCH REPORT" : "MATCH REPORT"),
                el(
                    "div",
                    {
                        display: "flex",
                        marginTop: 26,
                        fontSize: 20,
                        fontWeight: 600,
                        letterSpacing: 1.5,
                        color: INK_2,
                        textTransform: "uppercase",
                    },
                    `FT · ${date} · ${s.headline.outlet}`
                ),
                el(
                    "div",
                    {
                        display: "block",
                        marginTop: 10,
                        fontFamily: "Barlow Condensed",
                        fontWeight: 700,
                        fontSize: s.headline.text.length > LONG_HEADLINE ? 48 : 58,
                        lineHeight: 1.08,
                        lineClamp: 3,
                    },
                    s.headline.text
                ),
                el("div", {display: "flex", flexGrow: 1}),
                el(
                    "div",
                    {display: "flex", alignItems: "center", justifyContent: "space-between"},
                    team(await this.#crest(s.who, 64, {photoSize: 112}), s.who.shortName, s.who.company),
                    el(
                        "div",
                        {display: "flex", flexDirection: "column", alignItems: "center"},
                        el(
                            "span",
                            {
                                fontFamily: "Barlow Condensed",
                                fontWeight: 800,
                                fontSize: 96,
                                lineHeight: 1,
                                padding: "4px 28px 0",
                                backgroundColor: ACCENT,
                                color: ON_ACCENT,
                            },
                            String(s.forks)
                        ),
                        el("span", {fontSize: 18, color: MUTED, marginTop: 8}, `pitchforks of ${max}`)
                    ),
                    el(
                        "div",
                        {display: "flex", justifyContent: "flex-end", width: 400},
                        el(
                            "div",
                            {display: "flex", alignItems: "center", gap: 18},
                            el(
                                "div",
                                {display: "flex", flexDirection: "column", alignItems: "flex-end"},
                                el(
                                    "span",
                                    {fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 44, lineHeight: 1},
                                    "THE PUBLIC"
                                ),
                                el("span", {fontSize: 20, color: MUTED, marginTop: 4}, `Crowd: ${s.backlashStrength}`)
                            ),
                            img(LEAGUE_CREST, 64, 74)
                        )
                    )
                ),
                el(
                    "div",
                    {display: "flex", width: BAR_WIDTH, height: 10, marginTop: 26, backgroundColor: SURFACE_3},
                    ...segments.map((segment, i) =>
                        el("div", {
                            display: "flex",
                            width: segment.width,
                            height: 10,
                            backgroundColor: segment.colour,
                            marginRight: i < segments.length - 1 ? 3 : 0,
                        })
                    )
                )
            )
        );
    }

    async #drawSiteCard({standings, statements}: SiteCard): Promise<Buffer> {
        const position = (row: Standing) => {
            const place = 1 + standings.filter((other) => other.total > row.total).length;
            return standings.filter((other) => other.total === row.total).length > 1 ? `=${place}` : String(place);
        };
        const top = standings.slice(0, TABLE_ROWS);
        const crests = await Promise.all(
            top.map((row, i) => this.#crest(row.ceo, 36, {stroke: i === 0 ? GOLD : RING, photoSize: 44}))
        );
        const row = (r: Standing, i: number) =>
            el(
                "div",
                {
                    display: "flex",
                    alignItems: "center",
                    height: 62,
                    padding: "0 20px",
                    backgroundColor: i === 0 ? "rgba(200, 240, 60, 0.07)" : "transparent",
                    borderBottom: `1px solid ${LINE}`,
                    borderLeft: `5px solid ${i === 0 ? GOLD : "transparent"}`,
                },
                el("span", {width: 56, fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 34}, position(r)),
                crests[i],
                el(
                    "span",
                    {
                        marginLeft: 16,
                        fontFamily: "Barlow Condensed",
                        fontWeight: 700,
                        fontSize: 34,
                        textTransform: "uppercase",
                    },
                    r.ceo.name
                ),
                i === 0 && r.total > 0
                    ? el(
                          "span",
                          {
                              marginLeft: 16,
                              fontFamily: "Barlow Condensed",
                              fontWeight: 700,
                              fontSize: 18,
                              letterSpacing: 1,
                              padding: "2px 10px",
                              backgroundColor: GOLD,
                              color: ON_GOLD,
                          },
                          this.content.get().rubric.titles.first.toUpperCase()
                      )
                    : null,
                el("div", {display: "flex", flexGrow: 1}),
                el("span", {fontSize: 20, color: MUTED, marginRight: 28}, `${r.own.length} played`),
                el(
                    "span",
                    {
                        width: 90,
                        textAlign: "right",
                        fontFamily: "Barlow Condensed",
                        fontWeight: 800,
                        fontSize: 40,
                        color: i === 0 ? ACCENT : INK,
                    },
                    String(r.total)
                )
            );

        return this.#render(
            this.#frame(
                this.#masthead("ALL-TIME"),
                el(
                    "div",
                    {
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        marginTop: 22,
                        marginBottom: 10,
                    },
                    el(
                        "span",
                        {fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 52, lineHeight: 1},
                        "LEAGUE TABLE"
                    ),
                    el(
                        "span",
                        {fontSize: 20, color: MUTED},
                        `${statements.length} statements on the record · every quote real · scored in pitchforks`
                    )
                ),
                el("div", {display: "flex", flexDirection: "column", borderTop: `1px solid ${LINE}`}, ...top.map(row))
            )
        );
    }
}

export default PreviewService;
