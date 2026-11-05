const NETWORK_SENTENCE = "The line to the referee dropped. Check your connection and try again.";
const FALLBACK_SENTENCE = "The referee could not take that one. Try again later.";

let reportTab = "stats";
let activeVar = null;

async function sendFeedback(path, body) {
    try {
        const response = await fetch(path, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify(body),
        });
        if (response.ok) return {ok: true};
        let message = "";
        try {
            message = (await response.json())?.error ?? "";
        } catch {}
        return {ok: false, message: typeof message === "string" && message ? message : FALLBACK_SENTENCE};
    } catch {
        return {ok: false, message: NETWORK_SENTENCE};
    }
}

function countChars(field, counter) {
    const paint = () => {
        counter.textContent = `${field.value.length} / ${field.maxLength}`;
    };
    field.addEventListener("input", paint);
    paint();
    return paint;
}

function sendingLabel(button, sending, label) {
    button.disabled = sending;
    button.textContent = sending ? "Sending…" : label;
}

function bindTabs(root) {
    const bar = root.querySelector("[role=tablist]");
    if (!bar) return;
    const tabs = [...bar.querySelectorAll("[role=tab]")];
    const panels = [...root.querySelectorAll("[role=tabpanel]")];
    const select = (id, focus) => {
        reportTab = id;
        for (const tab of tabs) {
            const on = tab.dataset.tab === id;
            tab.setAttribute("aria-selected", String(on));
            tab.tabIndex = on ? 0 : -1;
            if (on && focus) tab.focus();
        }
        for (const panel of panels) panel.hidden = panel.dataset.tab !== id;
    };
    for (const tab of tabs) tab.addEventListener("click", () => select(tab.dataset.tab, false));
    bar.addEventListener("keydown", (event) => {
        const ids = tabs.map((tab) => tab.dataset.tab);
        const at = ids.indexOf(reportTab);
        const next = {ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: ids.length - 1}[event.key];
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        select(ids[(next + ids.length) % ids.length], true);
    });
    select(tabs.some((tab) => tab.dataset.tab === reportTab) ? reportTab : tabs[0].dataset.tab, false);
}

function bindVar(root) {
    const section = root.querySelector("[data-var]");
    if (!section) return;
    const SEND = "Send to VAR";
    const row = section.querySelector(".var-row");
    const openButton = section.querySelector(".var-open");
    const form = section.querySelector(".var-form");
    const reason = form.querySelector("textarea");
    const error = form.querySelector(".form-error");
    const send = form.querySelector("[type=submit]");
    const thanks = section.querySelector(".var-thanks");
    const paintCount = countChars(reason, form.querySelector(".char-count"));
    const many = form.dataset.unitMany;

    const close = () => {
        form.hidden = true;
        row.hidden = false;
        openButton.setAttribute("aria-expanded", "false");
        activeVar = null;
        openButton.focus();
    };
    openButton.addEventListener("click", () => {
        form.reset();
        paintCount();
        error.textContent = "";
        row.hidden = true;
        form.hidden = false;
        openButton.setAttribute("aria-expanded", "true");
        activeVar = {close};
        form.querySelector('input[name="var-count"]').focus();
    });
    form.querySelector("[data-var-cancel]").addEventListener("click", close);
    const clear = () => {
        error.textContent = "";
    };
    form.addEventListener("input", clear);
    form.addEventListener("change", clear);
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        const category = form.querySelector('input[name="var-count"]:checked')?.value;
        const direction = form.querySelector('input[name="var-direction"]:checked')?.value;
        if (!category) {
            error.textContent = "Pick the count you want the referee to look at.";
            form.querySelector('input[name="var-count"]').focus();
            return;
        }
        if (!direction) {
            error.textContent = `More ${many} or fewer?`;
            form.querySelector('input[name="var-direction"]').focus();
            return;
        }
        sendingLabel(send, true, SEND);
        const result = await sendFeedback("/api/dispute", {
            statementId: section.dataset.var,
            category,
            direction,
            comment: reason.value,
            website: form.elements.website.value,
        });
        sendingLabel(send, false, SEND);
        if (!result.ok) {
            error.textContent = result.message;
            return;
        }
        form.hidden = true;
        activeVar = null;
        thanks.hidden = false;
        thanks.focus();
    });
}

async function copyLink(button, path) {
    try {
        await navigator.clipboard.writeText(`${location.origin}${path}`);
        button.textContent = "Link copied";
    } catch {
        button.textContent = "Link in the address bar";
    }
    setTimeout(() => {
        button.textContent = "Copy link";
    }, 2500);
}

const sharePath = (id) => `/s/${encodeURIComponent(id)}`;
const matchPath = (id) => `/match/${encodeURIComponent(id)}`;

const pageBody = document.querySelector(".report-page [data-report-body]");
if (pageBody) {
    bindTabs(pageBody);
    bindVar(pageBody);
    const copy = document.querySelector(".report-page [data-copy]");
    copy?.addEventListener("click", () => copyLink(copy, copy.dataset.copy));
}

const report = document.getElementById("report");
if (report) {
    const body = document.getElementById("report-body");
    const position = document.getElementById("report-position");
    const prev = report.querySelector("[data-prev]");
    const next = report.querySelector("[data-next]");
    const copy = report.querySelector("[data-copy]");
    const idsOf = (el) => (el?.dataset.reportList ?? "").split(" ").filter(Boolean);
    const everyStatement = idsOf(report);
    const bodies = new Map();
    let list = [];
    let index = -1;
    let opener = null;
    let leftAt = null;
    let pending = 0;

    // the report's ids are the page's own, so in the dialog they take a prefix to stay unique
    const prefixIds = (root) => {
        for (const el of root.querySelectorAll("[id]")) el.id = `d-${el.id}`;
        for (const attr of ["for", "aria-controls", "aria-labelledby", "aria-describedby"]) {
            for (const el of root.querySelectorAll(`[${attr}]`)) {
                el.setAttribute(attr, `d-${el.getAttribute(attr)}`);
            }
        }
    };

    const champions = (report.dataset.champions ?? "").split(" ").filter(Boolean);
    const clubPath = report.dataset.clubPath;
    const followSeason = (root) => {
        const ceo = root.querySelector("[data-ceo]")?.dataset.ceo;
        if (!ceo) return;
        const club = root.querySelector(".sb-team.home");
        if (club && clubPath) club.setAttribute("href", clubPath + encodeURIComponent(ceo));
        const gold = champions.includes(ceo);
        for (const el of root.querySelectorAll(".sb-team.home .crest, .rp-speaker .face, .rp-speaker .face-crest")) {
            el.classList.toggle("gold", gold);
        }
    };

    const load = async (id) => {
        if (bodies.has(id)) return bodies.get(id);
        const response = await fetch(matchPath(id));
        if (!response.ok) throw new Error(`${response.status}`);
        const page = new DOMParser().parseFromString(await response.text(), "text/html");
        const found = page.querySelector("[data-report-body]");
        if (!found) throw new Error("no report");
        prefixIds(found);
        bodies.set(id, found.innerHTML);
        return found.innerHTML;
    };

    const show = async (at) => {
        const id = list[at];
        const ticket = ++pending;
        let html;
        try {
            html = await load(id);
        } catch {
            location.assign(matchPath(id));
            return;
        }
        if (ticket !== pending) return;
        index = at;
        report.dataset.current = id;
        activeVar = null;
        body.innerHTML = html;
        followSeason(body);
        bindTabs(body);
        bindVar(body);
        body.scrollTop = 0;
        position.textContent = `${index + 1} of ${list.length}`;
        const focused = document.activeElement;
        prev.disabled = index <= 0;
        next.disabled = index >= list.length - 1;
        if ((focused === prev && prev.disabled) || (focused === next && next.disabled)) {
            (prev.disabled ? next : prev).focus();
        }
        copy.textContent = "Copy link";
        history.replaceState(history.state, "", matchPath(id));
        if (!report.open) {
            report.showModal();
            report.querySelector("[data-close]").focus();
        }
    };

    const open = (id, from) => {
        const ids = idsOf(from);
        list = ids.includes(id) ? ids : everyStatement;
        if (!report.open) {
            opener = document.activeElement;
            leftAt = location.pathname + location.search + location.hash;
        }
        show(list.indexOf(id));
    };

    const step = (delta) => {
        const to = index + delta;
        if (to < 0 || to >= list.length) return;
        show(to);
    };

    document.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest?.("a[data-report]");
        if (!link || report.contains(link)) return;
        event.preventDefault();
        open(link.dataset.report, link.closest("[data-report-list]"));
    });
    prev.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    report.querySelector("[data-close]").addEventListener("click", () => report.close());
    copy.addEventListener("click", () => copyLink(copy, sharePath(list[index])));
    report.addEventListener("click", (event) => {
        if (event.target === report) report.close();
    });
    document.addEventListener("keydown", (event) => {
        if (!report.open || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (event.target.closest?.("a, [role=tab], select, input, textarea")) return;
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
    });
    report.addEventListener("cancel", (event) => {
        if (!activeVar) return;
        event.preventDefault();
        activeVar.close();
    });
    report.addEventListener("close", () => {
        activeVar = null;
        pending++;
        if (leftAt !== null) history.replaceState(history.state, "", leftAt);
        leftAt = null;
        if (opener?.isConnected) opener.focus({preventScroll: true});
        opener = null;
    });
}

const suggest = document.getElementById("suggest");
if (suggest) {
    const form = document.getElementById("suggest-form");
    const thanks = document.getElementById("suggest-thanks");
    const error = document.getElementById("suggest-error");
    const url = document.getElementById("suggest-url");
    const ceo = document.getElementById("suggest-ceo");
    const quote = document.getElementById("suggest-quote");
    const note = document.getElementById("suggest-note");
    const send = form.querySelector("[data-send]");
    const intro = suggest.querySelector(".suggest-intro");
    const SEND = send.textContent;
    let opener = null;
    const painters = [...suggest.querySelectorAll("[data-count-for]")].map((counter) =>
        countChars(document.getElementById(counter.dataset.countFor), counter)
    );

    const open = (button) => {
        opener = button;
        form.reset();
        for (const paint of painters) paint();
        error.textContent = "";
        sendingLabel(send, false, SEND);
        form.hidden = false;
        intro.hidden = false;
        thanks.hidden = true;
        suggest.showModal();
        url.focus();
    };
    for (const button of document.querySelectorAll("[data-suggest]")) {
        button.addEventListener("click", () => open(button));
    }
    for (const button of suggest.querySelectorAll("[data-suggest-close]")) {
        button.addEventListener("click", () => suggest.close());
    }
    suggest.addEventListener("click", (event) => {
        if (event.target === suggest) suggest.close();
    });
    suggest.addEventListener("close", () => {
        if (opener?.isConnected) opener.focus();
        opener = null;
    });
    const clear = () => {
        error.textContent = "";
    };
    form.addEventListener("input", clear);
    form.addEventListener("change", clear);
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        if (!url.value.trim()) {
            error.textContent = "A link, please: where it was said or reported.";
            url.focus();
            return;
        }
        sendingLabel(send, true, SEND);
        const result = await sendFeedback("/api/suggest", {
            url: url.value.trim(),
            ceo: ceo.value || undefined,
            quote: quote.value,
            note: note.value,
            website: form.elements.website.value,
        });
        sendingLabel(send, false, SEND);
        if (!result.ok) {
            error.textContent = result.message;
            return;
        }
        form.hidden = true;
        intro.hidden = true;
        thanks.hidden = false;
        thanks.querySelector(".thanks-title").focus();
    });
}
