# Conformance fixtures

`scripts/conformance.mjs` drives the built CLI against a real backend with
every document in this directory, asserting the acceptance criteria from
[`docs/pdf.md` §11](../../docs/pdf.md): artifact layout, local reuse with zero
cloud calls, convert-without-reparse, and durable (non-expiring) markdown.

The documents themselves are **not** in the repository — they are large, and
the ones that exercise parsing well tend to be real work files. Bring your own
(the DeckRender repo's `tests/test-data` uses the same naming and works here
as-is).

## What to put here

One file per extension. The script picks `test.<ext>` automatically;
`CONFORMANCE_<EXT>` environment variables override.

| File           | Covers                                                       |
| -------------- | ------------------------------------------------------------ |
| `test.pdf`     | the flagship: versioned IR, `--anchors` provenance comments  |
| `test.pptx`    | slide parsing, `--split-pages`, zip-asset image localization |
| `test.docx`    | element-tree parsing, inline image keys                      |
| `test.key`     | Keynote parsing, `--stay-image-area-rate`                    |
| `test.xlsx`    | asserts spreadsheets still fail `unsupported` with a hint    |
| `test.numbers` | the same, from iWork                                         |

Documents **with images** are more useful than text-only ones: image
localization and link rewriting only get exercised when the cloud response
carries an image manifest. Multi-page documents exercise `--split-pages`.

## Running it

```bash
pnpm build
DECKPARSE_API_BASE=… DECKPARSE_TOKEN=… pnpm conformance
```

It needs credentials, spends backend quota, and uploads the fixtures to the
backend — so it is not part of `pnpm test`, and the fixtures stay untracked.
