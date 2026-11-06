import {vi} from "vitest";
import {success} from "../../../src/lib/result.js";
import type {Content, RawStatement} from "../../../src/lib/content.js";
import LeagueService from "../../../src/services/league-service.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import {makeSite, type Route} from "../../../src/ui/site.js";
import {fake, fakeLog, makeContent, makeContentService} from "../helpers.js";

const NOW = Date.UTC(2026, 10, 15, 12);

export async function siteFor(
    statements: RawStatement[],
    season?: string,
    route: Route = {view: "table"},
    content: Content = makeContent()
) {
    const repo = fake<StatementRepository>({listPublished: vi.fn().mockResolvedValue(success(statements))});
    const league = await new LeagueService(repo, makeContentService(content), fakeLog(), () => NOW).get();
    if (!league.ok) throw new Error(league.ctx);
    return makeSite(league.data, content, season, route);
}
