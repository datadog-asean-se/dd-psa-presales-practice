# LLM Observability for Next.js (In-Code SDK Setup)

## Table of Contents

- [Initialization](#initialization)
- [LLMObs singleton](#llmobs-singleton)
- [Span kinds and tracing](#span-kinds-and-tracing)
- [Enriching spans](#enriching-spans)
- [Prompt tracking](#prompt-tracking)
- [Task spans for evaluation](#task-spans-for-evaluation)
- [Complete example](#complete-example)

## Initialization

Use the Next.js `register()` instrumentation hook to initialize dd-trace
with LLMObs. This runs once at server start before any routes load.

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { default: tracer } = await import("dd-trace");
    tracer.init({
      llmobs: {
        mlApp: process.env.DD_LLMOBS_ML_APP ?? process.env.DD_SERVICE,
        agentlessEnabled: true,  // sends LLM data directly via DD_API_KEY
      },
    });
  }
}
```

**Critical**: Never combine this with `NODE_OPTIONS="--require dd-trace/init"`.

## LLMObs singleton

Re-export `tracer.llmobs` from a dedicated module for clean imports:

```typescript
// src/lib/llmobs.ts
import tracer from "dd-trace";
export const llmobs = tracer.llmobs;
```

## Span kinds and tracing

LLMObs supports these span kinds: `llm`, `task`, `workflow`, `agent`, `tool`.

### Basic LLM span

```typescript
import { llmobs } from "../lib/llmobs";

await llmobs.trace(
  {
    kind: "llm",
    name: "gemini.generateContent",
    modelName: "gemini-2.5-pro",
    modelProvider: "google",
    sessionId: rumSessionId,  // optional: links to RUM session
  },
  async () => {
    // LLM API call here
  }
);
```

### Conditional span naming

Name spans dynamically based on context for easier filtering:

```typescript
await llmobs.trace(
  {
    kind: "llm",
    name: isDebrief ? "exercise.debrief" : "gemini.generateContent",
    modelName: modelId,
    modelProvider: "google",
  },
  async () => { /* ... */ }
);
```

## Enriching spans

Use `llmobs.annotate()` inside a traced span to add input/output data,
metadata, and custom tags:

```typescript
llmobs.annotate({
  inputData: messages.map((m) => ({
    role: m.role === "model" ? "assistant" : m.role,
    content: m.text,
  })),
  outputData: [{ role: "assistant", content: fullResponse }],
  metadata: {
    exerciseId,
    language,
    temperature: 0.7,
  },
  tags: {
    team_name: teamName,
    practice_name: practiceName,
  },
});
```

**Tags** are indexed and searchable in the LLM Observability Explorer.
Use them for filtering by team, exercise, feature, etc.

## Prompt tracking

Use `llmobs.annotationContext()` to define a prompt template with automatic
versioning. The SDK hashes the template content to detect changes.

```typescript
const SYSTEM_PROMPT_TEMPLATE = `You are an AI assistant.
Context: {{context}}
Language: {{language}}`;

await llmobs.annotationContext(
  {
    prompt: {
      id: "my-prompt-id",
      template: SYSTEM_PROMPT_TEMPLATE,
      variables: {
        context: actualContextValue,
        language: "English",
      },
    },
  },
  async () => {
    // Inner llmobs.trace() call here — the prompt metadata is
    // automatically attached to all spans created inside this callback
    await llmobs.trace({ kind: "llm", name: "my-llm-call" }, async () => {
      // ...
    });
  }
);
```

### Template syntax

Use `{{variable_name}}` placeholders. The `variables` object maps each
placeholder to its actual value for that invocation.

Ref: https://docs.datadoghq.com/llm_observability/instrumentation/sdk/?tab=nodejs#prompt-tracking

## Task spans for evaluation

Wrap logical operations in `task` spans to target them with Datadog
Evaluations (quality scoring, safety checks, etc.):

```typescript
await llmobs.trace(
  {
    kind: "task",
    name: "exercise.debrief",
    sessionId: rumSessionId,
  },
  async () => {
    llmobs.annotate({
      inputData: conversationMessages,
      metadata: { exerciseId, language },
      tags: { team_name: teamName, practice_name: practiceName },
    });

    // Inner LLM span (the actual API call)
    await runLLMSpan();

    // Annotate task output after the LLM stream completes
    llmobs.annotate({ outputData: capturedResponse });
  }
);
```

## Complete example

Pattern for a service function with both regular and debrief paths:

```typescript
export async function chatWithGeminiStream(
  messages: Message[],
  onChunk: (chunk: string) => void,
  exerciseId?: string,
  teamName?: string,
  sessionId?: string,
  isDebrief: boolean = false
) {
  let capturedResponse = "";
  const activeOnChunk = isDebrief
    ? (chunk: string) => { capturedResponse += chunk; onChunk(chunk); }
    : onChunk;

  const runLLMSpan = async () => {
    await llmobs.annotationContext(
      { prompt: { id: "my-prompt", template: TEMPLATE, variables: { /* ... */ } } },
      async () => {
        await llmobs.trace(
          { kind: "llm", name: isDebrief ? "exercise.debrief" : "llm.call", modelName, modelProvider: "google", sessionId },
          async () => {
            llmobs.annotate({ inputData: [...], tags: { team_name: teamName } });
            // stream LLM response, call activeOnChunk per chunk
            llmobs.annotate({ outputData: [{ role: "assistant", content: fullResponse }] });
          }
        );
      }
    );
  };

  if (isDebrief) {
    await llmobs.trace(
      { kind: "task", name: "exercise.debrief", sessionId },
      async () => {
        llmobs.annotate({ inputData: [...], tags: { team_name: teamName } });
        await runLLMSpan();
        llmobs.annotate({ outputData: capturedResponse });
      }
    );
  } else {
    await runLLMSpan();
  }
}
```
