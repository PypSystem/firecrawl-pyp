import {
  ALLOW_TEST_SUITE_WEBSITE,
  concurrentIf,
  describeIf,
  TEST_SUITE_WEBSITE,
} from "../lib";
import { scrape, scrapeRaw, scrapeTimeout, idmux, Identity } from "./lib";

// Cobre o screenshot servido pelo engine `playwright` (self-hosted, sem fire-engine). Só
// roda quando há microserviço Playwright: sem ele nenhum engine suporta screenshot.
const HAS_PLAYWRIGHT = !!process.env.PLAYWRIGHT_MICROSERVICE_URL;

let identity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "scrape-screenshot-playwright",
    concurrency: 10,
    credits: 1000000,
  });
}, 10000 + scrapeTimeout);

describeIf(ALLOW_TEST_SUITE_WEBSITE && HAS_PLAYWRIGHT)(
  "Scrape screenshot via playwright engine",
  () => {
    concurrentIf(true)(
      "returns a png data uri for the viewport screenshot",
      async () => {
        const response = await scrape(
          { url: TEST_SUITE_WEBSITE, formats: ["screenshot"] },
          identity,
        );

        expect(response.screenshot).toMatch(/^data:image\/png;base64,.+/);
      },
      scrapeTimeout,
    );

    concurrentIf(true)(
      "returns screenshot together with markdown and rawHtml in one request",
      async () => {
        const response = await scrape(
          {
            url: TEST_SUITE_WEBSITE,
            formats: [
              "markdown",
              "rawHtml",
              { type: "screenshot", fullPage: true },
            ],
          },
          identity,
        );

        expect(response.markdown).toBeTruthy();
        expect(response.rawHtml).toBeTruthy();
        expect(response.screenshot).toMatch(/^data:image\/png;base64,.+/);
      },
      scrapeTimeout,
    );

    concurrentIf(true)(
      "fails the request, instead of hanging, when the page cannot be reached",
      async () => {
        const raw = await scrapeRaw(
          {
            url: "https://this-domain-does-not-exist.invalid",
            formats: ["screenshot"],
          },
          identity,
        );

        expect(raw.statusCode).toBeGreaterThanOrEqual(400);
        expect(raw.body.success).toBe(false);
      },
      scrapeTimeout,
    );
  },
);
