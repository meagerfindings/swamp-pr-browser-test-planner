# @mgreten/pr-browser-test-planner

This model turns GitHub pull-request descriptions and paginated file patches into a stable, validated browser-command plan. Application-specific details are explicit configuration. It does not run the browser plan.

## Installation and prerequisites

Install this extension and its declared `@mgreten/cli-agent` dependency:

```sh
swamp extension pull @mgreten/pr-browser-test-planner
swamp extension pull @mgreten/cli-agent
```

Install `gh`, then authenticate an account that can read the configured repository. Verify before running the model:

```sh
gh auth login
gh auth status
```

Create a cli-agent model instance first. The default instance name is `cli-agent`.

## Setup

```sh
swamp model create @mgreten/pr-browser-test-planner planner --global-arguments '{
  "cliAgentModel":"cli-agent",
  "repoSlug":"acme/web-app",
  "repoPath":"/workspace/automation",
  "targetHost":"https://staging.example.com",
  "uiPathRules":["\\.(tsx?|jsx?|vue|svelte|css|scss|html)$"],
  "blockedPaths":["/admin","/billing"],
  "plannerGuidance":"Do not mutate user or billing settings.",
  "targetLabels":["desktop","mobile"],
  "ticketRegex":"\\bAPP-\\d+\\b"
}'
```

## Global arguments

| Argument | Type | Default / requirement |
|---|---|---|
| `cliAgentModel` | string | `cli-agent` |
| `repoSlug` | `owner/repo` | required |
| `repoPath` | string | required; swamp workspace containing cli-agent |
| `targetHost` | HTTPS origin | required; no path, credentials, query, or fragment |
| `uiPathRules` | regex string[] | common UI file extensions |
| `blockedPaths` | absolute path[] | `[]` |
| `plannerGuidance` | string | generic resilience guidance |
| `targetLabels` | string[] | `["default"]` |
| `ticketRegex` | regex string | generic uppercase ticket IDs |
| `maxSteps` | integer | `20` |
| `maxDiffBytes` | integer | `40000` |
| `plannerProvider` | string | `claude` |
| `plannerModel` | string | `sonnet` |
| `plannerTimeoutMs` | integer | `300000` |

## Method: `planForPr`

| Argument | Type | Description |
|---|---|---|
| `prNumber` | positive integer | Pull request number (required) |
| `deploySha` | string | Optional audit correlation value |
| `blockedPaths` | string[] | Extra blocked routes for this invocation |

```sh
swamp model method run planner planForPr --input '{"prNumber":42,"blockedPaths":["/internal"]}' --json
```

## Output contract

The `planForPr` resource always contains explicit `status` (`planned`, `skipped`, or `failed`), persisted `deploySha`, `prNumber`, `prTitle`, `baseRef`, `headRef`, `ticketIds`, `reasoning`, `steps`, `rejectedSteps`, `targetLabels`, `source`, `invocation`, and `generatedAt`. Backend-only results are `skipped`; dispatch and parse failures are `failed`, so neither can be mistaken for a successful empty plan.

```json
{"prNumber":42,"prTitle":"Improve search","baseRef":"main","headRef":"APP-42-search","ticketIds":["APP-42"],"reasoning":"Exercise search.","steps":[["open","https://staging.example.com/search"]],"rejectedSteps":[],"targetLabels":["desktop"],"source":{"hasExplicitTestPlan":true,"diffBytes":1200,"diffTruncated":false,"backendOnly":false},"invocation":{"provider":"claude","model":"sonnet","durationMs":2100,"costUsd":0.01,"error":null},"generatedAt":"2026-08-25T00:00:00.000Z"}
```

## How it works and security

The method invokes only fixed `gh pr view`, `gh api ... --paginate`, and `swamp model method run ... invokeAndParse` command shapes; values are passed as argument-array elements, never through a shell. PR text and diffs are strongly delimited as untrusted data and the model is told not to follow embedded instructions; deterministic validation remains authoritative. Every `open` command must use the canonical configured HTTPS origin and a safe path; encoded separators and dot segments are rejected. The exact-arity output contract permits only observational/navigation tuples (`open`, `wait`, `get`, `find`, `screenshot`, and constrained `scroll`)—never mutation-capable click, fill, or keypress commands. Diff limits are measured and truncated in UTF-8 bytes. Invalid planner commands are retained only in `rejectedSteps`. PR access uses the current `gh` authentication; no token is stored by this extension.

## License

MIT — see LICENSE.txt for details.
