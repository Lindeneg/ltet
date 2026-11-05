document.documentElement.dataset.js = "";
try {
    const theme = localStorage.getItem("ltet-theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}
try {
    const mode = sessionStorage.getItem("ltet-table-mode");
    if (mode === "full" || mode === "form") document.documentElement.dataset.tableMode = mode;
} catch {}
