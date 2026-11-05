(function () {
    "use strict";

    var PAD = 14;
    var EDGE = 8;

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function setup(root) {
        var frame = root.querySelector(".race-frame");
        var tooltip = root.querySelector(".tooltip");
        var months = JSON.parse(root.querySelector(".race-data").textContent);
        var n = months.length;
        var active = root.dataset.active;
        var hovered = null;
        var index = n - 1;
        var showing = false;
        var chips = Array.prototype.slice.call(document.querySelectorAll("[data-follow]"));

        function percent(i) {
            return n <= 1 ? 50 : (i / (n - 1)) * 100;
        }

        function band() {
            var bands = root.querySelectorAll(".bump");
            for (var i = 0; i < bands.length; i++) {
                if (bands[i].getClientRects().length) return bands[i];
            }
            return bands[0];
        }

        function plot() {
            return band().querySelector(".race-lines");
        }

        function eachSeries(fn) {
            root.querySelectorAll(".series").forEach(fn);
        }

        function hide() {
            showing = false;
            tooltip.hidden = true;
            root.querySelectorAll(".crosshair").forEach(function (line) {
                line.setAttribute("visibility", "hidden");
            });
        }

        function place(anchorX, anchorY) {
            var box = tooltip.getBoundingClientRect();
            var left = anchorX + PAD;
            if (left + box.width > window.innerWidth - EDGE) left = anchorX - box.width - PAD;
            var top = anchorY - box.height / 2;
            top = Math.min(Math.max(EDGE, top), window.innerHeight - box.height - EDGE);
            tooltip.style.left = Math.max(EDGE, left) + "px";
            tooltip.style.top = top + "px";
        }

        function showAt(i, clientY) {
            if (n === 0) return;
            index = Math.max(0, Math.min(n - 1, i));
            showing = true;
            var month = months[index];
            var x = percent(index) + "%";
            root.querySelectorAll(".crosshair").forEach(function (line) {
                line.setAttribute("x1", x);
                line.setAttribute("x2", x);
                line.setAttribute("visibility", "visible");
            });

            var head = el("span", "row head");
            head.append(
                el("span", "pos", ""),
                el("span", "", ""),
                el("span", "num", "Total"),
                el("span", "num", "Added")
            );
            var rows = month.rows.map(function (t) {
                var row = el("span", "row" + (t.id === active ? " active" : ""));
                row.append(
                    el("span", "pos", t.pos),
                    el("span", "", t.name),
                    el("span", "num", String(t.total)),
                    el("span", "num added" + (t.added > 0 ? "" : " none"), t.added > 0 ? "+" + t.added : "")
                );
                return row;
            });
            tooltip.replaceChildren.apply(tooltip, [el("strong", "", month.title), head].concat(rows));
            tooltip.hidden = false;

            var bounds = plot().getBoundingClientRect();
            var anchorX = bounds.left + (percent(index) / 100) * bounds.width;
            place(anchorX, clientY === undefined ? bounds.top + bounds.height / 2 : clientY);
        }

        function indexAt(clientX) {
            var bounds = plot().getBoundingClientRect();
            var px = clientX - bounds.left;
            if (px < -12 || px > bounds.width + 12) return -1;
            if (n === 1) return 0;
            return Math.round((px / bounds.width) * (n - 1));
        }

        function markHover() {
            eachSeries(function (group) {
                group.classList.toggle("hover", group.dataset.id === hovered && hovered !== active);
            });
        }

        function press() {
            chips.forEach(function (chip) {
                chip.setAttribute("aria-pressed", String(chip.dataset.follow === active));
            });
        }

        function follow(id) {
            if (id === active) return;
            active = id;
            eachSeries(function (group) {
                var on = group.dataset.id === id;
                group.classList.toggle("active", on);
                if (on) group.parentNode.append(group);
            });
            press();
            markHover();
            if (showing) showAt(index);
        }

        function select(group) {
            if (group.dataset.id === active) return;
            if (group.dataset.href) window.location.assign(group.dataset.href);
            else follow(group.dataset.id);
        }

        eachSeries(function (group) {
            group.addEventListener("pointerenter", function () {
                hovered = group.dataset.id;
                markHover();
            });
            group.addEventListener("pointerleave", function () {
                hovered = null;
                markHover();
            });
            group.addEventListener("click", function () {
                select(group);
            });
        });

        chips.forEach(function (chip) {
            chip.addEventListener("click", function () {
                follow(chip.dataset.follow);
            });
        });

        frame.addEventListener("pointermove", function (event) {
            if (event.pointerType !== "mouse") return;
            var i = indexAt(event.clientX);
            if (i < 0) hide();
            else showAt(i, event.clientY);
        });
        frame.addEventListener("pointerleave", function (event) {
            if (event.pointerType === "mouse") hide();
        });
        frame.addEventListener("click", function (event) {
            var i = indexAt(event.clientX);
            if (i >= 0) showAt(i, event.clientY);
        });
        frame.addEventListener("keydown", function (event) {
            var moves = {ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: n - 1};
            if (event.key in moves) {
                event.preventDefault();
                showAt(moves[event.key]);
                var bounds = plot().getBoundingClientRect();
                var cx =
                    bounds.left -
                    frame.getBoundingClientRect().left +
                    frame.scrollLeft +
                    (percent(index) / 100) * bounds.width;
                if (cx < frame.scrollLeft + 40 || cx > frame.scrollLeft + frame.clientWidth - 40) {
                    frame.scrollLeft = cx - frame.clientWidth / 2;
                }
            } else if (event.key === "Escape" && showing) {
                event.stopPropagation();
                hide();
            }
        });
        frame.addEventListener("focus", function () {
            if (frame.matches(":focus-visible")) showAt(index);
        });
        frame.addEventListener("blur", hide);
        document.addEventListener("pointerdown", function (event) {
            if (showing && !frame.contains(event.target)) hide();
        });
        frame.addEventListener(
            "scroll",
            function () {
                if (showing) showAt(index);
            },
            {passive: true}
        );

        var lastWidth = -1;
        new ResizeObserver(function () {
            if (frame.clientWidth === lastWidth) return;
            lastWidth = frame.clientWidth;
            frame.scrollLeft = frame.scrollWidth;
            if (showing) showAt(index);
        }).observe(frame);
    }

    function init() {
        document.querySelectorAll("[data-race-chart]").forEach(setup);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
