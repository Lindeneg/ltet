import {SiteLayout} from "../../components/layout.js";
import {SITE_NAME, type Site} from "../../site.js";
import {ErrorBody} from "./error-body.js";

export function NotFoundView(site?: Site): string {
    return SiteLayout({
        title: `Not found · ${SITE_NAME}`,
        site,
        noindex: true,
        children: ErrorBody({
            code: "404",
            heading: "Offside",
            text: "There's no page at this address.",
            home: site?.href("table") ?? "/",
        }),
    });
}
