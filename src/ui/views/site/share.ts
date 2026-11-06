import type {ScoredStatement} from "../../../lib/score.js";
import {esc} from "../../lib.js";

export type ShareViewProps = {
    statement: ScoredStatement;
    url: string;
    image: {url: string; width: number; height: number; alt: string};
    description: string;
    target: string;
    canonical: string;
};

export function ShareView({statement, url, image, description, target, canonical}: ShareViewProps): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(statement.headline.text)} | Let Them Eat Tokens</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="noindex">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Let Them Eat Tokens">
  <meta property="og:title" content="${esc(statement.headline.text)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(image.url)}">
  <meta property="og:image:width" content="${esc(String(image.width))}">
  <meta property="og:image:height" content="${esc(String(image.height))}">
  <meta property="og:image:alt" content="${esc(image.alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image:alt" content="${esc(image.alt)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta http-equiv="refresh" content="0; url=${esc(target)}">
</head>
<body>
  <p><a href="${esc(target)}">Read what ${esc(statement.who.name)} actually said</a></p>
</body>
</html>`;
}
