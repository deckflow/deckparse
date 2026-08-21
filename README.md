# DeckParse

> Parse any document into an agent-operable representation.

DeckParse turns documents into **durable IR artifacts** and derives views from them. Parse once — then convert, again and again, without ever re-reading the source.

```bash
deckparse doc.pdf                  # document → IR artifact (doc/)
deckparse convert doc/             # artifact → markdown view, no re-parse
deckparse convert doc.pdf -o doc.md  # one-shot: portable markdown, images localized
```

It is the **Parse** pillar of the [DeckFlow](https://github.com/deckflow) family: [DeckRender](https://github.com/deckflow/deckrender) turns documents into pixels, DeckParse turns them into state an agent can hold on to.

## Install

```bash
npx -y @deckflow/deckparse@latest doc.pdf
```

```bash
npm install -g @deckflow/deckparse
```

Requires Node.js 18 or newer.

## Two verbs, deliberately

```
parse    document → IR artifact     the only parsing action; produces IR, never markdown
convert  IR artifact → view        --to markdown (v1); never re-parses the source
```

`deckparse doc.pdf` is `parse`. The artifact it leaves behind is the point:

```
doc/
├── ir.json          the parsed document model, server response verbatim
├── assets/          images by persistent identity
├── manifest.json    source hash, cloud references, what exists where
└── views/markdown/  written by convert, never by parse
```

- **Parse twice, pay once.** Same bytes + same options = instant local reuse, zero cloud calls. `--json` reports `"engine": "local-cache"` so scripts can verify instead of assume.
- **Convert never re-parses.** The view is derived from the stored IR by reference (`reusedParse: true` is asserted, not hoped). The IR stays convertible for **7 days**; after that, a clear `ir_expired` error says exactly what to re-run.
- **Markdown that survives the week.** Image links in cloud responses are signed URLs that expire in hours. DeckParse downloads every image and rewrites the links — a convert that can't secure its images **fails** rather than shipping links that will rot (`--keep-remote-images` opts out).

## Supported formats

```bash
deckparse formats
```

| Input | parse → IR | convert → markdown | flags |
| --- | --- | --- | --- |
| `.pdf` | ✅ versioned IR (stable node ids, bbox, `schemaVersion`) | ✅ | `--profile fast\|balanced\|quality`, `--password`, `--no-images`, `--anchors` |
| `.pptx` | ✅ | ✅ | `--split-pages` |
| `.docx` | ✅ | ✅ | |
| `.key` | ✅ | ✅ | `--stay-image-area-rate`, `--split-pages` |
| http(s) URL | ✅ | ✅ | `--mode source\|runtime` |
| `.doc` `.ppt` `.xls(x)` `.pages` `.numbers` | ❌ | ❌ | clear error + a way out |

Unsupported pairs fail with a hint, never an approximation.

## Machine-readable output

```bash
$ deckparse convert doc/ --json
{
  "ok": true,
  "op": "convert",
  "engine": "cloud",
  "format": "pdf",
  "taskId": "t_abc123",
  "reusedParse": true,
  "outputs": [{ "file": "doc/views/markdown/index.md", "bytes": 48213 }],
  "warnings": [],
  "durationMs": 728
}
```

Errors carry a stable `error.code` and a distinct exit code:

| exit | `error.code` | meaning |
| --- | --- | --- |
| 2 | `usage_error` | bad flags, or a flag that cannot apply to this input |
| 3 | `unsupported` | unsupported extension or `--to` target |
| 4 | `auth_error` | credential rejected or expired |
| 5 | `input_error`, `ir_not_found`, `ir_expired`, `ir_schema_unsupported`, `ir_invalid`, `asset_error` | fixable by the caller — each carries a hint saying how |
| 6 | `backend_error` | task failed; includes the taskId for follow-up |
| 7 | `not_implemented` | reserved verbs (`extract`, `modify`, `export`) |
| 8 | `quota_error` | guest quota exhausted — `deckparse auth login` |

## Authentication is shared

Credentials live in `~/.deckflow/credentials` and are shared with every DeckFlow CLI — log in once through DeckParse, DeckRender or DeckHTML and the others pick it up:

```bash
deckparse auth login
deckparse config list     # every value, and exactly where it came from
```

Environment variables win over stored files: `DECKPARSE_API_KEY` → `DECKFLOW_API_KEY` → `DECKHTML_API_KEY` (and `DECKPARSE_TOKEN` / `DECKPARSE_API_BASE` / `DECKPARSE_SPACE_ID` likewise). Each field resolves independently — when something authenticates oddly, `deckparse config list` shows which file or variable is responsible.

**Where parsing happens:** all parsing runs in the DeckFlow cloud — the document is uploaded over HTTPS, parsed there, results downloaded back. Nothing in v1 keeps a document on your machine. If your documents cannot leave your machine, DeckParse is not for you yet.

## Use it as a library

```ts
import { parse, openArtifact } from '@deckflow/deckparse';

const doc = await parse('doc.pdf', { profile: 'quality' });
doc.irKey;                          // the cloud reference convert consumes
await doc.convert();                // view materialized into the artifact
await doc.convert({ anchors: true }); // pdf: provenance comments carrying node ids

// Days later, in another process — no cloud call to reopen:
const same = await openArtifact('doc/');
await same.convert({ splitPages: true });
```

`extract`, `modify` and `export` are reserved verbs on the same handle — the roadmap runs Parse → Extract → Modify → Export → render-verified round trips.

## Development

```bash
pnpm install
pnpm check          # typecheck + unit + integration + build

# conformance drives the built CLI against a real backend:
DECKPARSE_API_BASE=… DECKPARSE_TOKEN=… \
CONFORMANCE_PDF=sample.pdf CONFORMANCE_PPTX=sample.pptx pnpm conformance
```

The `--json` envelope, error codes, exit codes, artifact layout and the shared credential file format are public contracts. Changing any of them is a breaking change; note it in `CHANGELOG.md`.

## License

MIT © DeckFlow
