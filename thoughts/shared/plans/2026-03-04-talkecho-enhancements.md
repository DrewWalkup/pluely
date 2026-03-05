# TalkEcho-Inspired Enhancements Implementation Plan

## Overview

Adopt 5 enhancements discovered in the TalkEcho fork to improve UX (per-provider variable persistence), security (CORS avoidance, XSS prevention), and audio quality (STT language selection, VAD deduplication).

## Code Rules (from `.claude/rules/rule_one.md`)

Every change in this plan MUST adhere to these rules — they are non-negotiable:

1. **Clean and readable code** — Junior developers on a HealthTech team (hospital setting) will maintain this.
2. **Functions that do only one thing, well** — Each new helper must have a single responsibility.
3. **Descriptive variable names** — Never `r`, `res`, `cb`. Use `response`, `savedVariables`, `recentTranscriptions`, etc.
4. **Highly accurate and maintainable** — All changes verified against existing patterns.
5. **NEVER compress scope without asking permission** — Every enhancement fully implemented.

## Current State Analysis

### What exists now:

- `onSetSelectedAIProvider` / `onSetSelectedSttProvider` in `app.context.tsx:523-568` overwrite variables on switch — previous values are lost
- `stt.function.ts:188` and `ai-response.function.ts:294` conditionally use `tauriFetch` only for non-HTTP URLs, browser `fetch` for HTTP — causes CORS issues with some providers
- Markdown rendering uses `Streamdown` library (`src/components/Markdown/index.tsx`) — not `react-markdown`, so `rehype-sanitize` may not apply directly
- `fetchSTT` in `stt.function.ts` does not pass a language parameter to providers
- `useSystemAudio.ts` processes transcriptions without deduplication — VAD can fire twice on the same audio segment

### Key Discoveries:

- `app.context.tsx:240-253` loads selected providers from localStorage with `JSON.parse` — no sanitization of parsed variables
- `stt.function.ts:188` uses `url?.includes("http") ? fetch : tauriFetch` — the intent was to use tauriFetch for relative URLs, but this breaks CORS for third-party HTTP endpoints
- Same pattern at `ai-response.function.ts:294`
- `Streamdown` is a third-party streaming markdown renderer — need to verify its XSS posture before adding sanitization
- Rust `transcribe_audio` (`api.rs:196`) is Nyx-API-only — STT language must be wired through `fetchSTT` for custom curl providers

## Desired End State

After implementation:

1. Switching between AI/STT providers preserves and restores API keys per provider
2. All HTTP requests to third-party providers use `tauriFetch` to avoid CORS
3. Users can select an STT language that gets passed to their STT provider
4. Markdown rendering is verified safe against XSS from LLM output
5. Duplicate VAD transcriptions are silently skipped

### How to verify:

- `npm run build` passes with zero TypeScript errors
- Switch AI providers back and forth → API keys are restored
- Configure a CORS-restrictive STT provider → requests succeed via tauriFetch
- Set STT language → verify it appears in the outgoing request
- Trigger VAD twice on same audio → only one transcription processed

## What We're NOT Doing

- **No Rust changes** — STT language is wired through the frontend `fetchSTT` only, not the Rust `transcribe_audio` command (which is Nyx-API-only)
- **No migration of existing localStorage data** — Per-provider variables start fresh; existing selected provider variables are preserved as-is
- **No new npm dependencies** unless `Streamdown` lacks sanitization (Phase 4 will determine this)
- **No refactoring** of existing provider selection UI — only the save/restore logic changes
- **No changes to the system audio daemon** — only the speaker module's VAD pipeline

## Implementation Approach

Phases are ordered by priority and dependency. Phase 1 (variable persistence) is the highest-impact UX fix. Phase 2 (tauriFetch) is a two-line change with large impact. Phase 3 (STT language) builds on context patterns from Phase 1. Phase 4 (XSS) is investigative. Phase 5 (VAD dedup) is self-contained.

---

## Phase 1: Per-Provider Variable Persistence

### Overview

Save provider variables (API keys, model names, etc.) per provider ID before switching, and restore them when switching back. Add prototype-pollution hardening to all JSON-parsed variable maps.

### Changes Required:

#### 1. Add storage keys

**File**: `src/config/constants.ts`
**Changes**: Add two new storage keys

```typescript
// In STORAGE_KEYS, add after SELECTED_STT_PROVIDER:
AI_PROVIDER_VARIABLES_BY_ID: "curl_ai_provider_variables_by_id",
STT_PROVIDER_VARIABLES_BY_ID: "curl_stt_provider_variables_by_id",
```

#### 2. Add sanitization helpers

**File**: `src/contexts/app.context.tsx`
**Changes**: Add three helper functions before the `AppProvider` component

```typescript
/**
 * Creates a plain object with no prototype chain.
 * Prevents prototype-pollution attacks when storing user-provided keys.
 */
function createNullProtoObject(): Record<string, unknown> {
	return Object.create(null);
}

/** Keys that must never appear in user-provided variable maps. */
const FORBIDDEN_VARIABLE_KEYS = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

/**
 * Strips dangerous keys and non-string values from a raw variable map.
 * Returns a clean Record<string, string> safe for storage and use.
 */
function sanitizeProviderVariables(
	rawVariables: Record<string, unknown>,
): Record<string, string> {
	const sanitizedVariables = createNullProtoObject() as Record<
		string,
		string
	>;

	for (const [key, value] of Object.entries(rawVariables)) {
		if (!FORBIDDEN_VARIABLE_KEYS.has(key) && typeof value === "string") {
			sanitizedVariables[key] = value;
		}
	}

	return sanitizedVariables;
}

/**
 * Parses a JSON string of per-provider variable maps from localStorage.
 * Each key is a provider ID, each value is a sanitized variable map.
 * Returns a safe null-proto object on any parse failure.
 */
function parseProviderVariablesById(
	storageValue: string | null,
): Record<string, Record<string, string>> {
	if (!storageValue) {
		return createNullProtoObject() as Record<
			string,
			Record<string, string>
		>;
	}

	try {
		const parsed = JSON.parse(storageValue);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return createNullProtoObject() as Record<
				string,
				Record<string, string>
			>;
		}

		const sanitizedResult = createNullProtoObject() as Record<
			string,
			Record<string, string>
		>;
		for (const [providerId, variables] of Object.entries(parsed)) {
			if (
				!FORBIDDEN_VARIABLE_KEYS.has(providerId) &&
				typeof variables === "object" &&
				variables !== null
			) {
				sanitizedResult[providerId] = sanitizeProviderVariables(
					variables as Record<string, unknown>,
				);
			}
		}
		return sanitizedResult;
	} catch {
		return createNullProtoObject() as Record<
			string,
			Record<string, string>
		>;
	}
}
```

#### 3. Update `onSetSelectedAIProvider`

**File**: `src/contexts/app.context.tsx`
**Changes**: Save current variables before switching, restore saved variables for new provider

Replace the current `onSetSelectedAIProvider` (lines 523-552) with:

```typescript
const onSetSelectedAIProvider = ({
	provider,
	variables,
}: {
	provider: string;
	variables: Record<string, string>;
}) => {
	if (provider && !allAiProviders.some((p) => p.id === provider)) {
		console.warn(`Invalid AI provider ID: ${provider}`);
		return;
	}

	// Update supportsImages immediately when provider changes
	if (!pluelyApiEnabled) {
		const selectedProvider = allAiProviders.find((p) => p.id === provider);
		if (selectedProvider) {
			const hasImageSupport =
				selectedProvider.curl?.includes("{{IMAGE}}") ?? false;
			setSupportsImages(hasImageSupport);
		} else {
			setSupportsImages(true);
		}
	}

	// Save current provider's variables before switching
	const currentProviderId = selectedAIProvider.provider;
	if (
		currentProviderId &&
		Object.keys(selectedAIProvider.variables).length > 0
	) {
		const savedVariablesById = parseProviderVariablesById(
			safeLocalStorage.getItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES_BY_ID),
		);
		savedVariablesById[currentProviderId] = sanitizeProviderVariables(
			selectedAIProvider.variables,
		);
		safeLocalStorage.setItem(
			STORAGE_KEYS.AI_PROVIDER_VARIABLES_BY_ID,
			JSON.stringify(savedVariablesById),
		);
	}

	// Restore previously saved variables for the new provider (if any)
	let restoredVariables = variables;
	if (provider && Object.keys(variables).every((key) => !variables[key])) {
		const savedVariablesById = parseProviderVariablesById(
			safeLocalStorage.getItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES_BY_ID),
		);
		const previouslySaved = savedVariablesById[provider];
		if (previouslySaved && Object.keys(previouslySaved).length > 0) {
			restoredVariables = { ...variables, ...previouslySaved };
		}
	}

	setSelectedAIProvider((prev) => ({
		...prev,
		provider,
		variables: restoredVariables,
	}));
};
```

#### 4. Update `onSetSelectedSttProvider`

**File**: `src/contexts/app.context.tsx`
**Changes**: Same pattern as AI provider — save before switch, restore on switch

Replace the current `onSetSelectedSttProvider` (lines 555-568) with:

```typescript
const onSetSelectedSttProvider = ({
	provider,
	variables,
}: {
	provider: string;
	variables: Record<string, string>;
}) => {
	if (provider && !allSttProviders.some((p) => p.id === provider)) {
		console.warn(`Invalid STT provider ID: ${provider}`);
		return;
	}

	// Save current provider's variables before switching
	const currentProviderId = selectedSttProvider.provider;
	if (
		currentProviderId &&
		Object.keys(selectedSttProvider.variables).length > 0
	) {
		const savedVariablesById = parseProviderVariablesById(
			safeLocalStorage.getItem(STORAGE_KEYS.STT_PROVIDER_VARIABLES_BY_ID),
		);
		savedVariablesById[currentProviderId] = sanitizeProviderVariables(
			selectedSttProvider.variables,
		);
		safeLocalStorage.setItem(
			STORAGE_KEYS.STT_PROVIDER_VARIABLES_BY_ID,
			JSON.stringify(savedVariablesById),
		);
	}

	// Restore previously saved variables for the new provider (if any)
	let restoredVariables = variables;
	if (provider && Object.keys(variables).every((key) => !variables[key])) {
		const savedVariablesById = parseProviderVariablesById(
			safeLocalStorage.getItem(STORAGE_KEYS.STT_PROVIDER_VARIABLES_BY_ID),
		);
		const previouslySaved = savedVariablesById[provider];
		if (previouslySaved && Object.keys(previouslySaved).length > 0) {
			restoredVariables = { ...variables, ...previouslySaved };
		}
	}

	setSelectedSttProvider((prev) => ({
		...prev,
		provider,
		variables: restoredVariables,
	}));
};
```

### Success Criteria:

#### Automated Verification:

- [x] `npm run build` compiles with zero TypeScript errors
- [x] No `__proto__` / `constructor` / `prototype` keys can be stored in variable maps

#### Manual Verification:

- [ ] Configure AI Provider A with an API key → switch to Provider B → switch back to A → API key is restored
- [ ] Same test for STT providers
- [ ] Fresh install (no localStorage) works without errors
- [ ] Variables persist across app restart

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Always Use tauriFetch

### Overview

Replace the conditional `url?.includes("http") ? fetch : tauriFetch` pattern with always using `tauriFetch`. This avoids CORS issues when calling third-party AI/STT providers directly from the Tauri app.

### Changes Required:

#### 1. Update `stt.function.ts`

**File**: `src/lib/functions/stt.function.ts`
**Changes**: Replace line 188

```typescript
// Before:
const fetchFunction = url?.includes("http") ? fetch : tauriFetch;

// After:
const fetchFunction = tauriFetch;
```

#### 2. Update `ai-response.function.ts`

**File**: `src/lib/functions/ai-response.function.ts`
**Changes**: Replace line 294

```typescript
// Before:
const fetchFunction = url?.includes("http") ? fetch : tauriFetch;

// After:
const fetchFunction = tauriFetch;
```

### Success Criteria:

#### Automated Verification:

- [x] `npm run build` compiles with zero TypeScript errors

#### Manual Verification:

- [ ] AI provider requests still work (test with at least one provider)
- [ ] STT provider requests still work
- [ ] No CORS errors in browser console
- [ ] Streaming responses still function correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: STT Language Selection

### Overview

Add a persisted `sttLanguage` preference that gets passed to STT providers via the `fetchSTT` function. Most STT APIs accept a `language` parameter in their form data or request body.

### Changes Required:

#### 1. Add storage key

**File**: `src/config/constants.ts`
**Changes**: Add to `STORAGE_KEYS`

```typescript
STT_LANGUAGE: "stt_language",
```

#### 2. Add to context type

**File**: `src/types/context.type.ts`
**Changes**: Add after `setSupportsImages`

```typescript
sttLanguage: string;
setSttLanguage: Dispatch<SetStateAction<string>>;
```

#### 3. Add state to context

**File**: `src/contexts/app.context.tsx`
**Changes**: Add state declaration after `supportsImages` state

```typescript
const [sttLanguage, setSttLanguageState] = useState<string>(() => {
	return safeLocalStorage.getItem(STORAGE_KEYS.STT_LANGUAGE) || "en";
});

const setSttLanguage = (language: string) => {
	setSttLanguageState(language);
	safeLocalStorage.setItem(STORAGE_KEYS.STT_LANGUAGE, language);
};
```

Add to context value object:

```typescript
sttLanguage,
setSttLanguage,
```

Add to `loadData()` function:

```typescript
// Load STT language
const savedSttLanguage = safeLocalStorage.getItem(STORAGE_KEYS.STT_LANGUAGE);
if (savedSttLanguage) {
	setSttLanguageState(savedSttLanguage);
}
```

Add to storage sync `handleStorageChange`:

```typescript
// Add STT_LANGUAGE to the list of keys that trigger loadData()
e.key === STORAGE_KEYS.STT_LANGUAGE;
```

#### 4. Wire language into fetchSTT

**File**: `src/lib/functions/stt.function.ts`
**Changes**: Add `language` parameter to `STTParams` and pass it to the request

```typescript
export interface STTParams {
	provider: TYPE_PROVIDER | undefined;
	selectedProvider: {
		provider: string;
		variables: Record<string, string>;
	};
	audio: File | Blob;
	language?: string; // ISO 639-1 code (e.g., "en", "de", "zh")
}
```

In the `fetchSTT` function, add `language` to `allVariables`:

```typescript
const allVariables = {
	...Object.fromEntries(
		Object.entries(selectedProvider.variables).map(([key, value]) => [
			key.toUpperCase(),
			value,
		]),
	),
	LANGUAGE: params.language || "en",
};
```

For form-based uploads (like OpenAI Whisper), add language to the form data after the file append:

```typescript
// Inside the isForm block, after form.append("file", ...):
if (params.language) {
	form.append("language", params.language);
}
```

#### 5. Pass language from callers

**File**: `src/hooks/useSystemAudio.ts`
**Changes**: Where `fetchSTT` is called, add the language parameter. The hook already has access to app context. Find the `fetchSTT` call and add `language` from context.

Search for `fetchSTT({` in useSystemAudio.ts and add:

```typescript
language: sttLanguage, // from useApp() context
```

**File**: `src/pages/chats/components/AudioRecorder.tsx`
**Changes**: Same — pass language to `fetchSTT`. The component uses `useApp()` context.

```typescript
const { selectedSttProvider, allSttProviders, selectedAudioDevices, sttLanguage } = useApp();
// ... in fetchSTT call:
language: sttLanguage,
```

#### 6. Add language dropdown to STT settings

**File**: `src/pages/dev/components/stt-configs/index.tsx`
**Changes**: Add a language select dropdown. Use a simple list of common STT languages.

```typescript
const STT_LANGUAGES = [
	{ code: "en", label: "English" },
	{ code: "zh", label: "Chinese" },
	{ code: "de", label: "German" },
	{ code: "es", label: "Spanish" },
	{ code: "fr", label: "French" },
	{ code: "ja", label: "Japanese" },
	{ code: "ko", label: "Korean" },
	{ code: "pt", label: "Portuguese" },
	{ code: "ru", label: "Russian" },
	{ code: "ar", label: "Arabic" },
	{ code: "hi", label: "Hindi" },
	{ code: "it", label: "Italian" },
] as const;
```

Add a `Select` component for language selection, using `sttLanguage` / `setSttLanguage` from context.

### Success Criteria:

#### Automated Verification:

- [x] `npm run build` compiles with zero TypeScript errors
- [x] `IContextType` includes `sttLanguage` and `setSttLanguage`

#### Manual Verification:

- [ ] Language dropdown appears in STT settings
- [ ] Selected language persists across app restart
- [ ] Language parameter appears in outgoing STT requests (check network tab or add console.log)
- [ ] OpenAI Whisper API receives the `language` form field

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 4: Markdown XSS Investigation

### Overview

Investigate whether `Streamdown` (our markdown renderer) sanitizes HTML output. If it doesn't, add sanitization. If it does, document it and move on.

### Changes Required:

#### 1. Investigate Streamdown's sanitization

**Action**: Check Streamdown's documentation and source for HTML sanitization behavior.

- Does it strip `<script>` tags?
- Does it strip `onclick` and other event handlers?
- Does it strip `javascript:` URLs?
- Does it allow raw HTML pass-through?

#### 2. If Streamdown does NOT sanitize:

**Option A**: Configure Streamdown to disable raw HTML (if it has such an option)

**Option B**: Pre-sanitize the markdown string before passing to Streamdown:

```bash
npm install dompurify
npm install -D @types/dompurify
```

**File**: `src/components/Markdown/index.tsx`

```typescript
import DOMPurify from "dompurify";

export function Markdown({ children, isStreaming = false }: MarkdownRendererProps) {
  const sanitizedContent = DOMPurify.sanitize(children, {
    ALLOWED_TAGS: [], // Strip all HTML tags from raw markdown input
  });

  return (
    <Streamdown isAnimating={isStreaming} /* ... */>
      {sanitizedContent}
    </Streamdown>
  );
}
```

#### 3. If Streamdown DOES sanitize:

No code changes needed. Add a comment in the Markdown component:

```typescript
// Streamdown handles HTML sanitization internally — no additional XSS protection needed.
```

### Success Criteria:

#### Automated Verification:

- [x] `npm run build` compiles with zero TypeScript errors (Streamdown already sanitizes via rehype-sanitize — no code changes needed)

#### Manual Verification:

- [ ] Test with markdown containing `<script>alert('xss')</script>` — should not execute
- [ ] Test with `[link](javascript:alert('xss'))` — should not execute
- [ ] Normal markdown rendering (code blocks, math, tables) still works correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 5: VAD Transcription Deduplication

### Overview

Add deduplication logic to `useSystemAudio.ts` to skip processing when VAD fires twice on the same audio segment, producing identical or near-identical transcriptions within a short time window.

### Changes Required:

#### 1. Add deduplication state and logic

**File**: `src/hooks/useSystemAudio.ts`
**Changes**: Add a ref to track recent transcriptions and a helper to check for duplicates.

```typescript
/** Tracks recent transcriptions to prevent duplicate processing from VAD double-fires. */
const recentTranscriptionsRef = useRef<{ text: string; timestamp: number }[]>(
	[],
);

/** Maximum age (ms) for a transcription to be considered a duplicate. */
const DEDUP_WINDOW_MS = 3000;

/**
 * Checks if a transcription was already processed recently.
 * Returns true if the text matches a transcription within the dedup window.
 */
const isDuplicateTranscription = useCallback((text: string): boolean => {
	const now = Date.now();

	// Clean up old entries outside the dedup window
	recentTranscriptionsRef.current = recentTranscriptionsRef.current.filter(
		(entry) => now - entry.timestamp < DEDUP_WINDOW_MS,
	);

	// Check if this exact text was recently processed
	const isDuplicate = recentTranscriptionsRef.current.some(
		(entry) => entry.text === text,
	);

	if (!isDuplicate) {
		// Record this transcription
		recentTranscriptionsRef.current.push({ text, timestamp: now });
	}

	return isDuplicate;
}, []);
```

#### 2. Guard transcription processing

**File**: `src/hooks/useSystemAudio.ts`
**Changes**: Find where transcription results are processed (around line 275 based on grep results) and add the dedup check.

```typescript
// Before processing the transcription:
if (transcription.trim()) {
	// Add dedup check
	if (isDuplicateTranscription(transcription.trim())) {
		console.debug(
			"Skipping duplicate transcription:",
			transcription.trim().substring(0, 50),
		);
		return; // or continue, depending on the control flow
	}

	setLastTranscription(transcription);
	// ... rest of existing processing
}
```

### Success Criteria:

#### Automated Verification:

- [x] `npm run build` compiles with zero TypeScript errors
- [x] No new TypeScript warnings in useSystemAudio.ts

#### Manual Verification:

- [ ] VAD recording produces transcriptions normally (no false dedup)
- [ ] Rapidly repeated VAD triggers on the same audio don't produce duplicate transcriptions
- [ ] Different transcriptions (even similar ones) are not incorrectly filtered
- [ ] Console shows "Skipping duplicate" debug message when dedup triggers

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Testing Strategy

### Manual Testing Steps:

1. **Phase 1**: Configure Provider A with API key → switch to B → switch back → verify key restored
2. **Phase 2**: Make an AI request to a third-party provider → verify no CORS errors in console
3. **Phase 3**: Set STT language to "de" → record audio → verify language param in request
4. **Phase 4**: Paste `<script>alert(1)</script>` into chat → verify no script execution
5. **Phase 5**: Trigger VAD rapidly → verify only one transcription per audio segment

### Edge Cases:

- Phase 1: Provider deleted while its variables are saved → should not crash
- Phase 1: Empty variables → should not save empty object for provider
- Phase 2: Local/relative URLs → tauriFetch should handle them (it already does)
- Phase 3: No language set → defaults to "en"
- Phase 5: Legitimately repeated phrases → should NOT be deduped (different timestamps, same text is OK after 3s window)

## Performance Considerations

- Phase 1: One extra `localStorage.getItem` + `JSON.parse` per provider switch — negligible
- Phase 2: `tauriFetch` goes through Tauri's HTTP plugin (Rust reqwest) instead of browser fetch — may be slightly different in connection handling but should be comparable or better
- Phase 5: Dedup array is capped by time window (3s) — at most ~10 entries, O(n) scan is negligible

## References

- TalkEcho fork: https://github.com/RuizhangZhou/talkecho
- TalkEcho PR #56: Per-provider variable persistence
- TalkEcho commit "fix: use tauriFetch to avoid CORS issues" (Feb 11, 2026)
- Current `app.context.tsx`: Provider selection at lines 523-568
- Current `stt.function.ts`: Conditional fetch at line 188
- Current `ai-response.function.ts`: Conditional fetch at line 294
- Current `Markdown/index.tsx`: Streamdown renderer
- Current `useSystemAudio.ts`: Transcription processing around line 270-290
