import {esc} from "../../lib.js";

export type ErrorBodyProps = {code: string; heading: string; text: string; home: string};

export function ErrorBody({code, heading, text, home}: ErrorBodyProps): string {
    return `<section class="view" aria-labelledby="error-title">
      <div class="view-head">
        <div>
          <p class="eyebrow">${esc(code)}</p>
          <h1 id="error-title" tabindex="-1">${esc(heading)}</h1>
        </div>
      </div>
      <div class="empty card">
        <p>${esc(text)}</p>
        <a class="button" href="${esc(home)}">Back to the table</a>
      </div>
    </section>`;
}
