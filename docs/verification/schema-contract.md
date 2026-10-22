# Structured request checks

The single server-side Pramaan client checks every assistant action definition and structured reply schema before submission, including streamed replies and async calls. Connected-app and remote definitions are checked when discovered and when loaded from an older cache. Ordinary action input data is left unchanged.

Allowed keywords: type, properties, required, additionalProperties, items, enum, const, anyOf, $defs, $ref, title, description, default, examples, minimum, maximum, exclusiveMinimum, exclusiveMaximum, minLength, maxLength, minItems and maxItems. The root must have type object. References must be local #/... pointers to existing schema nodes; recursive references are refused.

Each schema must fit 64 KB, 256 nodes and depth 16. A union permits up to sixteen branches and an enum up to 256 values. A chat request's combined schemas must also fit 64 KB. Unsupported dialect metadata ($schema) is removed. Format is retained only as a description hint, because the platform does not accept it as a validation rule. Constraints such as pattern, oneOf, allOf and uniqueItems are refused rather than silently weakened. Failures name the definition and its exact path, without including example values or credentials.

The backend build validates all twenty-six shipped definitions, covering the assistant, project, tabular, legal, Word, memory and research-recipe features. The test transport independently refuses schemas outside the same contract. Dynamic definitions cannot be known at build time, so discovery and dispatch reject incompatible schemas before a generated reply starts. Their original definitions remain stored for fresh comparison and action approval; normalization never changes that approval identity.

Current structured generation uses llm.chat; llm.complete currently receives plain prompts without a schema. The four research recipes currently receive no schema fields. The client also guards any future explicit schema/jsonSchema recipe input. document.extract is not used by this product: its read contract requires object properties, local references and at most 8,000 serialized characters, rather than sharing the generation contract's validator. A conservative bounded-subset guard is ready for that field without adding a new extraction feature.

Tabular results stay provisional until their reply succeeds. Refused or interrupted replies never commit partial cells as completed. Failed cells retain a safe reason and a Review and retry button that opens the existing Regenerate action. Stopped work returns to pending. Previously successful cells and separately completed actions are preserved; uncertain actions still require checking their service before retrying. Conversation history marks error events and failed connected actions as failed, while successful earlier artifacts remain recorded independently.

All verification uses synthetic responses. No live sign-in, action or generation was performed for these checks.

Generation requests always use messages. Explicit reply limits below 64 are raised to 64 at the single client boundary; the plain-completion adapter applies the same minimum. The platform default applies when no limit is supplied. Fixed product requests use 256, 512, 2,048 or 8,192; the hard minimum for an explicit limit remains 64.

The deployed platform currently refuses legal research with an unavailable result, according to the operator's first live check of another template. For law.citations.lookup, law.cases.search, law.case.get and law.opinion.get, that failure becomes a plain not-available-yet notice. It survives stream filtering and collapsed steps without revealing upstream details. Failed searches are not successful empty searches, and failed citation checks do not validate or invalidate a citation. A later document request remains usable. No live check was performed by this template.


A reply ending with finishReason length is incomplete, even when its partial text looks like valid JSON. Streamed free text stays visible with an incomplete notice and a shorter-request retry instruction. Plain structured generation, action replies and tabular JSON lines fail before any result is returned or parsed. No partially supplied action runs and no charged reply is repeated automatically. Previously completed independent actions remain recorded.

An empty-reply invalid_request error naming maxTokens is a configuration error with a plain message. It never triggers whole-reply fallback or a background retry with the same settings. Both queue transports stop automatic retries for these errors and for cut-off replies; failed cells retain their reason and can be manually regenerated after revising the request. Memory diagnostics keep only the safe reason and retry classification. Optional chat titles use the existing local title fallback rather than adopting cut-off text.

The two title limits are 256. These checks prepare for the next platform deployment; verification used synthetic HTTP 200 partial replies and HTTP 400 errors, with no live call.
