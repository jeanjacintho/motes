# P3 · Decision layer (`packages/decision`)

> Back to [ROADMAP](../ROADMAP.md) · Design refs: DESIGN §11 (decision layer), §5 principle 3

**Goal of the phase:** a library every bot uses to make decisions at the cheapest tier that can make them (rule → classifier → cheap LLM → frontier), with a record and a cost for every call. It is built before the Boss and office bots so they are cheap from day one.

**Gate P3:** run a fixture set of 100 recorded routing decisions (message classification, "notify now or digest", "which bot") through the decider and see, in the cost view, how many were solved per tier, the total cost, and that none reached the frontier tier unless allowed.

---

## P3-01 · Core

### P3-01-01 · Decider interface
**What this is:** the single entry point: `decider.decide({ kind, schema, input, minTier?, maxTier?, budget? })` returning a typed value plus tier, model, confidence and cost (DESIGN §11).
**Why:** callers ask for a decision; they never pick a model themselves.
**Steps:**
1. Types `Tier`, `DecisionRequest<T>`, `DecisionResult<T>` in `packages/decision`.
2. A `Decider` that walks tiers in order from `minTier` to `maxTier`, asking each tier handler; a handler returns `decided` or `pass` (with a reason).
3. If every tier passes, throw `UndecidedError` carrying the escalation path.
**Done when:**
- [ ] Tests with fake tier handlers: order, floors, ceilings and the undecided error.
**Deps:** P0-02-02 · **Touches:** decision · **Size:** M

### P3-01-02 · Decision records
**What this is:** a row for every decision call.
**Steps:**
1. Table `decisions` (`id`, `kind`, `botId?`, `tier`, `model?`, `inputTokens`, `outputTokens`, `costUsd`, `confidence?`, `escalatedFrom` (array), `latencyMs`, `outcome` (the typed value, redacted), `at`).
2. The decider writes one record per call through an injected recorder (so the package has no DB dependency).
**Done when:**
- [ ] Test: one call = one record, including undecided calls.
**Deps:** P3-01-01, P0-03-02 · **Touches:** decision, db, domain · **Size:** S

### P3-01-03 · Budget-aware decisions
**Steps:**
1. Before a paid tier, estimate cost from input size and the model's prices; skip tiers that would exceed `budget.maxCostUsd` or the bot's remaining budget (P2-06-01).
2. Record skipped tiers as `pass(reason: 'budget')`.
**Done when:**
- [ ] Test: a low budget forces the decision to stay at free tiers or be undecided.
**Deps:** P3-01-02, P2-06-01 · **Touches:** decision · **Size:** S

---

## P3-02 · Rule tier

### P3-02-01 · Rule handler registry
**What this is:** deterministic functions registered per decision kind, tried first, free and instant.
**Steps:**
1. `registerRule(kind, (input) => Decided<T> | Pass)`; several rules per kind, run in order.
2. Rules must be pure and synchronous (enforced by type and a lint comment).
**Done when:**
- [ ] Test: a fully rule-decided call makes zero network calls (asserted with a fetch spy).
**Deps:** P3-01-01 · **Touches:** decision · **Size:** S

### P3-02-02 · Built-in rules
**What this is:** the first set of rules that remove the most common model calls.
**Steps:**
1. `is_duplicate`: same sender + same text within N minutes.
2. `owner_command`: exact commands (`status`, `pausa tudo`, `retoma`, `resumo`) → decided intent.
3. `notify_level`: `run.failed` after the last retry → `now`; `run.completed` with no review → `silent`; `card.review_requested` → `digest` unless the card is `urgent`.
4. `is_noise`: tapbacks, empty messages, stickers → ignore.
**Done when:**
- [ ] Table-driven tests for each rule.
**Deps:** P3-02-01 · **Touches:** decision · **Size:** M

---

## P3-03 · Model providers

### P3-03-01 · Provider interface and structured output
**What this is:** a thin abstraction over model APIs that always returns output validated against the request's zod schema.
**Steps:**
1. `ModelProvider.complete({ model, system, messages, schema, maxTokens })` → `{ value, usage }`.
2. Convert the zod schema to JSON Schema for providers that support structured output; otherwise prompt for JSON and parse.
3. One retry on invalid output, then `pass(reason: 'invalid_output')`.
**Done when:**
- [ ] Tests with a fake provider: valid output, invalid then valid, invalid twice.
**Deps:** P3-01-01 · **Touches:** decision · **Size:** M

### P3-03-02 · Anthropic provider
**Steps:**
1. Implementation using the official SDK, API key from the secret store (reference only).
2. Map usage (including cached tokens) and errors (rate limit → `pass(reason: 'rate_limited')`).
**Done when:**
- [ ] Recorded-fixture tests; a live test behind `MOTES_RUN_LIVE_MODEL_TESTS=1`.
**Deps:** P3-03-01, P2-05-01 · **Touches:** decision · **Size:** S

### P3-03-03 · OpenAI-compatible provider
**What this is:** one implementation for OpenRouter, Ollama, LM Studio and any OpenAI-compatible endpoint.
**Steps:**
1. Configurable base URL, key reference (optional for local servers), model list.
2. Detect local servers (Ollama on 11434, LM Studio on 1234) and offer them in settings.
**Done when:**
- [ ] Fixture tests for OpenRouter and Ollama response shapes.
**Deps:** P3-03-01 · **Touches:** decision · **Size:** S

### P3-03-04 · Model catalog and prices
**What this is:** the list of models available per provider with price per token, so costs can be computed and estimated.
**Steps:**
1. Table `models` (`provider`, `model`, `inputUsdPerMTok`, `outputUsdPerMTok`, `contextWindow`, `updatedAt`), editable in settings, seeded with defaults.
2. `estimateCost(model, inputTokens, outputTokens)`.
**Done when:**
- [ ] Test: cost of a recorded call matches the catalog price.
**Deps:** P3-03-01, P0-03-02 · **Touches:** decision, db · **Size:** S

---

## P3-04 · Paid tiers

### P3-04-01 · Tier configuration and escalation
**What this is:** which model serves the `cheap_llm` and `frontier` tiers, and when a tier escalates.
**Steps:**
1. Settings: model per tier (e.g. a small model for `cheap_llm`, a large one for `frontier`); per-kind override.
2. A model tier handler asks for `{ value, confidence }`; below the kind's threshold it passes with `low_confidence`.
**Done when:**
- [ ] Test: a low-confidence cheap answer escalates to frontier when allowed.
**Deps:** P3-03-02, P3-03-03, P3-03-04 · **Touches:** decision · **Size:** M

### P3-04-02 · Tier limits from the bot spec
**Steps:**
1. Bot spec gets `decision: { defaultMinTier, maxTier }`; requests inherit them unless they narrow further.
2. Validation: `minTier ≤ maxTier`.
**Done when:**
- [ ] Test: a request with `maxTier: cheap_llm` never reaches frontier.
**Deps:** P3-04-01, P1-05-01 · **Touches:** decision, protocol · **Size:** S

---

## P3-05 · Classifier tier (Jev)

### P3-05-01 · Vendor research and fake classifier
**What this is:** reading Jev's documentation and pinning down how Motes will call it, before writing the real client.
**Why:** cost and accuracy claims for decision models come from the vendors themselves; Motes must measure them on its own data.
**Steps:**
1. Write `packages/decision/JEV-NOTES.md`: endpoints, auth, input and output formats, limits, prices, how confidence is reported, terms of use.
2. Implement `FakeClassifier` with the same interface (typed choice + confidence) for tests.
**Done when:**
- [ ] Notes reviewed by the owner; the fake classifier is used in P3-05-02 tests.
**Deps:** P3-01-01 · **Touches:** decision · **Size:** S

### P3-05-02 · Jev provider
**Steps:**
1. Classifier tier handler calling Jev for choice-type decisions (enums, small sets of options); key from the secret store.
2. Threshold per decision kind; below it → `pass(low_confidence)`.
3. Non-choice decisions skip this tier.
**Done when:**
- [ ] Recorded-fixture tests for a confident decision and an escalation; live test behind a flag.
**Deps:** P3-05-01, P2-05-01 · **Touches:** decision · **Size:** M

### P3-05-03 · Fallback when the classifier is unavailable
**Steps:**
1. If Jev is not configured or failing, the classifier tier passes immediately (`unavailable`) and the cheap LLM tier handles choice decisions with a structured-output prompt.
2. Health indicator in settings.
**Done when:**
- [ ] Test: with Jev down, decisions still succeed at `cheap_llm` and the record shows the escalation.
**Deps:** P3-05-02, P3-04-01 · **Touches:** decision · **Size:** S

---

## P3-06 · Evaluation and visibility

### P3-06-01 · Decision eval harness
**What this is:** a CLI that replays recorded decisions against another configuration and compares.
**Steps:**
1. `pnpm motes eval decisions --from <date> --config <file>`: loads decisions (or a fixture file), re-runs them, reports agreement with the original (or with a labeled answer), cost and latency per tier.
2. Labeled fixture format (`input`, `expected`) in `packages/decision/fixtures/`.
**Done when:**
- [ ] A report compares two configurations on the bundled fixtures.
**Deps:** P3-05-03 · **Touches:** decision, scripts · **Size:** M

### P3-06-02 · Cost view `UI · visual TBD`
**Steps:**
1. Page with decisions per day split by tier, cost per bot and per decision kind, and a list of the most expensive kinds.
2. Link from a bot's page to its decisions.
**Done when:**
- [ ] Gate P3 passes.
**Deps:** P3-01-02, P1-10-04 · **Touches:** views, server, core · **Size:** M
