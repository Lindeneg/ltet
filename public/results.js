const results = document.querySelector(".results[data-report-list]");
const more = document.querySelector("[data-more]");
if (results && more) {
    const step = Number(more.dataset.more);
    const items = [...results.querySelectorAll(".match-item")];
    const months = [...results.querySelectorAll(".month")];
    const count = more.querySelector(".more-count");
    const button = more.querySelector("button");
    const phone = matchMedia("(max-width: 599px)");
    let limit = step;

    const paint = () => {
        const cut = phone.matches ? Math.min(limit, items.length) : items.length;
        items.forEach((item, i) => {
            item.hidden = i >= cut;
        });
        for (const month of months) month.hidden = !month.querySelector(".match-item:not([hidden])");
        more.hidden = cut >= items.length;
        count.textContent = `Showing ${cut} of ${items.length} matches`;
    };

    const revealTo = (at) => {
        if (at < limit) return;
        limit = Math.ceil((at + 1) / step) * step;
        paint();
    };

    button.addEventListener("click", () => {
        const first = limit;
        revealTo(first);
        items[first]?.querySelector("a")?.focus();
    });
    phone.addEventListener("change", paint);
    paint();

    const report = document.getElementById("report");
    let fromResults = false;
    document.addEventListener(
        "click",
        (event) => {
            const link = event.target.closest?.("a[data-report]");
            if (link && !report?.contains(link)) fromResults = results.contains(link);
        },
        true
    );
    report?.addEventListener("close", () => {
        if (!fromResults || !phone.matches) return;
        const at = items.findIndex((item) => item.querySelector("a")?.dataset.report === report.dataset.current);
        if (at < 0) return;
        revealTo(at);
        items[at].querySelector("a").focus();
    });
}
