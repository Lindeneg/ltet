(function () {
    "use strict";

    function init() {
        var links = Array.prototype.slice.call(document.querySelectorAll(".law-index a[data-law]"));
        if (!links.length) return;

        function mark(id) {
            links.forEach(function (link) {
                if (link.dataset.law === id) link.setAttribute("aria-current", "true");
                else link.removeAttribute("aria-current");
            });
        }

        links.forEach(function (link) {
            link.addEventListener("click", function (event) {
                var heading = document.getElementById("law-" + link.dataset.law + "-title");
                if (!heading) return;
                event.preventDefault();
                var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                heading.scrollIntoView({behavior: reduce ? "auto" : "smooth", block: "start"});
                heading.focus({preventScroll: true});
            });
        });

        var seen = new Map();
        var last = links[links.length - 1].dataset.law;

        // the last law is too short to reach the top of the window, so the bottom of the page marks it
        function atBottom() {
            var page = document.documentElement;
            return (
                page.scrollHeight > window.innerHeight && window.innerHeight + window.scrollY >= page.scrollHeight - 2
            );
        }

        function update() {
            if (atBottom()) return mark(last);
            var first = links.find(function (link) {
                return seen.get(link.dataset.law);
            });
            if (first) mark(first.dataset.law);
        }

        var observer = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    seen.set(entry.target.id.slice("law-".length), entry.isIntersecting);
                });
                update();
            },
            {rootMargin: "-80px 0px -45% 0px"}
        );
        var pending = false;
        window.addEventListener(
            "scroll",
            function () {
                if (pending) return;
                pending = true;
                requestAnimationFrame(function () {
                    pending = false;
                    update();
                });
            },
            {passive: true}
        );
        links.forEach(function (link) {
            var section = document.getElementById("law-" + link.dataset.law);
            if (section) observer.observe(section);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
