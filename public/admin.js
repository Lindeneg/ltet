(function () {
    "use strict";

    var WHEN = {dateStyle: "medium", timeStyle: "short"};

    function localDates() {
        document.querySelectorAll("time[data-local]").forEach(function (node) {
            var date = new Date(node.getAttribute("datetime"));
            if (!isNaN(date)) node.textContent = date.toLocaleString("en-GB", WHEN);
        });
    }

    function toasts() {
        document.querySelectorAll(".toast").forEach(function (node) {
            setTimeout(function () {
                node.remove();
            }, 2500);
        });
    }

    function totals() {
        document.querySelectorAll("[data-scores]").forEach(function (scores) {
            var form = scores.closest("form");
            var total = scores.querySelector("[data-total]");
            var json = form && form.querySelector("textarea[name=json]");
            var inputs = scores.querySelectorAll("input[data-weight]");
            function update() {
                try {
                    if (json) JSON.parse(json.value);
                } catch (e) {
                    total.textContent = "";
                    return;
                }
                var sum = 0;
                inputs.forEach(function (input) {
                    sum += Number(input.value) * Number(input.dataset.weight);
                });
                total.textContent = isFinite(sum) ? Math.round(sum) + " " + total.dataset.unit : "?";
            }
            inputs.forEach(function (input) {
                input.addEventListener("input", update);
            });
            if (json) json.addEventListener("input", update);
        });
    }

    function search() {
        var input = document.querySelector("[data-search-input]");
        if (!input) return;
        var rows = document.querySelectorAll("tr[data-search]");
        input.addEventListener("input", function () {
            var words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
            rows.forEach(function (row) {
                var text = row.dataset.search;
                row.hidden = !words.every(function (w) {
                    return text.indexOf(w) !== -1;
                });
            });
        });
    }

    localDates();
    toasts();
    totals();
    search();
})();
