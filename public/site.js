const root = document.documentElement;

const themeToggle = document.getElementById("theme-toggle");
const prefersDark = matchMedia("(prefers-color-scheme: dark)");
const effectiveTheme = () => root.dataset.theme ?? (prefersDark.matches ? "dark" : "light");

function paintTheme() {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    themeToggle.setAttribute("aria-label", `Switch to ${next} mode`);
    themeToggle.title = `Switch to ${next} mode`;
    themeToggle.querySelector("use").setAttribute("href", next === "dark" ? "#moon" : "#sun");
    themeToggle.querySelector(".theme-text").textContent = next === "dark" ? "Dark" : "Light";
}

themeToggle.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
        localStorage.setItem("ltet-theme", next);
    } catch {}
    paintTheme();
});
prefersDark.addEventListener("change", paintTheme);
paintTheme();

const tableMode = document.getElementById("table-mode");
if (tableMode) {
    const buttons = [...tableMode.querySelectorAll("button")];
    const paintMode = () => {
        const mode = root.dataset.tableMode ?? "short";
        for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    };
    for (const button of buttons) {
        button.addEventListener("click", () => {
            root.dataset.tableMode = button.dataset.mode;
            try {
                sessionStorage.setItem("ltet-table-mode", button.dataset.mode);
            } catch {}
            paintMode();
        });
    }
    paintMode();
}

document.querySelector("[data-skip]")?.addEventListener("click", (event) => {
    const heading = document.querySelector("main h1");
    if (!heading) return;
    event.preventDefault();
    heading.focus();
});

const SVG_NS = "http://www.w3.org/2000/svg";
const SHIELD = "M2 2h28v15.5c0 8.4-6 13.6-14 16.5C8 31.1 2 25.9 2 17.5z";

function fallBack(img) {
    const wrap = img.closest(".face[data-initials]");
    if (!wrap) return;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", wrap.className.replace(/^face\b/, "crest face-crest"));
    svg.setAttribute("viewBox", "0 0 32 36");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "crest-shield");
    path.setAttribute("d", SHIELD);
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("class", "crest-text");
    text.setAttribute("x", "16");
    text.setAttribute("y", "20.5");
    text.setAttribute("text-anchor", "middle");
    text.textContent = wrap.dataset.initials;
    svg.append(path, text);
    wrap.replaceWith(svg);
}

document.addEventListener(
    "error",
    (event) => {
        if (event.target instanceof HTMLImageElement && event.target.matches(".face-img")) fallBack(event.target);
    },
    true
);
for (const img of document.querySelectorAll(".face-img")) {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) fallBack(img);
}

for (const select of document.querySelectorAll("select[data-autosubmit]")) {
    select.addEventListener("change", () => select.form.requestSubmit());
}

const seasonMenu = document.querySelector(".season-menu");
if (seasonMenu) {
    document.addEventListener("click", (event) => {
        if (seasonMenu.open && !seasonMenu.contains(event.target)) seasonMenu.open = false;
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !seasonMenu.open) return;
        seasonMenu.open = false;
        seasonMenu.querySelector("summary").focus();
    });
}
