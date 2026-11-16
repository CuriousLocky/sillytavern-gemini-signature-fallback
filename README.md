# Gemini Tool Signature Fallback

A SillyTavern extension that fills missing Google thought signatures on historical assistant tool calls before sending a Chat Completions request.

## Scope

Runs only when all of these match:

- Connection source: **Custom (OpenAI-compatible)**.
- Endpoint matches an entry in the configured endpoint list.
- Model matches an entry in the configured model list.

The initial lists contain `https://litellm.lockyhome.icu` and `gemini-*`.

It sets `messages[].tool_calls[].extra_content.google.thought_signature`
to `skip_thought_signature_validator` only when that value is missing, null,
or empty. Existing signatures and other metadata are preserved.

The extension modifies outgoing requests and supports both streaming and
non-streaming responses. Google's skip marker provides a fallback for missing
signatures.

## Install

1. Copy this entire directory into your SillyTavern installation at:
   `public/scripts/extensions/third-party/sillytavern-gemini-signature-fallback`.
2. Reload SillyTavern.
3. Confirm **Gemini Tool Signature Fallback** appears in Extensions.
4. Configure endpoints and models in the extension's settings panel.

Alternatively, publish this repository to a Git host and install its URL using
SillyTavern's extension installer.

## Configuration

Open **Extensions → Gemini Tool Signature Fallback**.

- **Endpoints:** Enter a URL and click **Add** or press Enter. URLs are saved as
  origins (scheme, host, and port). For example, `https://proxy.example.com/v1`
  becomes `https://proxy.example.com` and matches all paths on that origin.
- **Models:** Add exact model names such as `gemini-4-hydrogen`, or prefix
  patterns such as `gemini-*`. Matching is case-sensitive. `*` matches every model.
- Click **Remove** beside an entry to delete it.

Changes save automatically to SillyTavern's extension settings and apply to
subsequent requests. These settings persist across page reloads and extension
updates. A request qualifies when its endpoint matches any endpoint entry and
its model matches any model entry. Both lists need at least one entry to activate
the fallback.

Disable this extension through SillyTavern's Extensions interface when no longer
needed, then reload the page.

## Implementation

Registers a listener for `CHAT_COMPLETION_SETTINGS_READY` through
`SillyTavern.getContext()` to fill missing tool-call signatures before submission.
