# ClaudeSynth for Nova

AI-powered code synthesis inside Nova. Write method implementations,
generate protocols, and explode abstractions — directly from your editor,
powered by Claude.

## Requirements

- [Nova](https://nova.app) by Panic
- An [Anthropic API key](https://console.anthropic.com)

## Setup

1. Install the extension from the Nova Extension Library
2. Go to **Extensions → ClaudeSynth → Preferences**
3. Paste in your Anthropic API key
4. Choose your preferred Claude model

## Commands

| Command            | Shortcut | Description                                           |
| ------------------ | -------- | ----------------------------------------------------- |
| Write / Implement  | ⌘⇧G      | Implements a method from its signature and comments   |
| Explode / Abstract | ⌘⇧E      | Decomposes into protocol + concrete type if warranted |
| Generate Protocol  | ⌘⇧P      | Extracts a clean interface from a concrete type       |
| Explain Selection  | ⌘⇧X      | Plain-English explanation with complexity notes       |

## Usage

Select a method stub, a comment describing intent, or an entire class —
then invoke a command. ClaudeSynth reads the selection (or full document
if nothing is selected) and sends it to Claude with a mode-specific prompt.

Generated code is inserted back at the selection, opened in a new document,
or copied to the clipboard — configurable in preferences.

## Models

- **Claude Sonnet 4.5** — recommended, best balance of speed and quality
- **Claude Opus 4.5** — most capable, use for complex abstractions
- **Claude Haiku 4.5** — fastest, good for simple implementations

## No dependencies

ClaudeSynth runs entirely within Nova's built-in JavaScript runtime.
No Node.js, npm, or external tools required.
