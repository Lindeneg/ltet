const TICKER_SPEED = 45;

const ticker = document.getElementById("ticker");
if (ticker) {
    const track = document.getElementById("ticker-track");
    const belt = document.getElementById("ticker-belt");
    const list = document.getElementById("ticker-list");
    const toggle = document.getElementById("ticker-toggle");
    const links = [...list.querySelectorAll(".tick")];

    let rover = 0;
    const rove = (index, focus) => {
        rover = (index + links.length) % links.length;
        links.forEach((link, i) => {
            link.tabIndex = i === rover ? 0 : -1;
        });
        if (focus) links[rover].focus();
    };
    rove(0, false);
    list.addEventListener("keydown", (event) => {
        const moves = {ArrowRight: rover + 1, ArrowLeft: rover - 1, Home: 0, End: links.length - 1};
        if (!(event.key in moves)) return;
        event.preventDefault();
        rove(moves[event.key], true);
    });

    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let position = 0;
    let loop = 0;
    let last = 0;
    let hovering = false;
    let focused = false;
    let paused = false;
    const moving = () => !reduced.matches && !paused && !hovering && !focused && loop > 0;
    const apply = () => {
        belt.style.transform = reduced.matches ? "" : `translate3d(${-position}px, 0, 0)`;
    };
    const measure = () => {
        loop = list.getBoundingClientRect().width;
    };
    const frame = (time) => {
        const elapsed = last ? Math.min(0.1, (time - last) / 1000) : 0;
        last = time;
        if (moving()) {
            position = (position + TICKER_SPEED * elapsed) % loop;
            apply();
        }
        requestAnimationFrame(frame);
    };
    new ResizeObserver(measure).observe(list);
    measure();
    requestAnimationFrame(frame);

    track.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        hovering = true;
    });
    track.addEventListener("pointerleave", () => {
        hovering = false;
    });
    track.addEventListener("focusin", (event) => {
        focused = true;
        const link = event.target.closest(".tick");
        rove(links.indexOf(link), false);
        if (!reduced.matches && link) {
            const left = link.parentElement.offsetLeft;
            const margin = Math.max(0, Math.min(24, (track.clientWidth - link.offsetWidth) / 2));
            if (left < position || left + link.offsetWidth > position + track.clientWidth) {
                position = Math.max(0, Math.min(left - margin, loop - 1));
            }
            apply();
            track.scrollLeft = 0;
        }
    });
    track.addEventListener("focusout", (event) => {
        if (track.contains(event.relatedTarget)) return;
        focused = false;
    });
    // the belt moves and not the track, so the scroll a focused link would cause is undone
    track.addEventListener("scroll", () => {
        if (!reduced.matches && track.scrollLeft !== 0) track.scrollLeft = 0;
    });
    const paintToggle = () => {
        const label = paused ? "Play the results ticker" : "Pause the results ticker";
        toggle.setAttribute("aria-label", label);
        toggle.title = label;
        toggle.querySelector("use").setAttribute("href", paused ? "#play" : "#pause");
    };
    toggle.addEventListener("click", () => {
        paused = !paused;
        paintToggle();
    });
    reduced.addEventListener("change", apply);
    paintToggle();
    apply();
}
