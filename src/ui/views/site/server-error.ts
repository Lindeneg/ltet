import {SiteLayout} from "../../components/layout.js";
import {SITE_NAME, type Site} from "../../site.js";
import {ErrorBody} from "./error-body.js";

export function ServerErrorView(site?: Site): string {
    return SiteLayout({
        title: `Error · ${SITE_NAME}`,
        site,
        children: ErrorBody({
            code: "500",
            heading: "Match suspended",
            text: "Something went wrong on our side. Try again in a moment.",
            home: site?.href("table") ?? "/",
        }),
    });
}
