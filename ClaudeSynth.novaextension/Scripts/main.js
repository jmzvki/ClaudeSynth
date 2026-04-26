var compositeDisposable = null;

exports.activate = function() {
    compositeDisposable = new CompositeDisposable();

    compositeDisposable.add(
        nova.commands.register("claudesynth.write", function(editor) {
            runCommand(editor, "write");
        })
    );

    compositeDisposable.add(
        nova.commands.register("claudesynth.explode", function(editor) {
            runCommand(editor, "explode");
        })
    );

    compositeDisposable.add(
        nova.commands.register("claudesynth.protocol", function(editor) {
            runCommand(editor, "protocol");
        })
    );

    compositeDisposable.add(
        nova.commands.register("claudesynth.explain", function(editor) {
            runCommand(editor, "explain");
        })
    );

    console.log("ClaudeSynth activated.");
};

exports.deactivate = function() {
    if (compositeDisposable) {
        compositeDisposable.dispose();
        compositeDisposable = null;
    }
};

// ─── Main pipeline ────────────────────────────────────────────────────────────

function runCommand(editor, mode) {
    var apiKey = nova.config.get("claudesynth.apiKey");
    var model  = nova.config.get("claudesynth.model") || "claude-sonnet-4-5";

    if (!apiKey) {
        nova.workspace.showErrorMessage("ClaudeSynth: No API key set. Add it in Extensions → ClaudeSynth Preferences.");
        return;
    }

    var context = resolveContext(editor);

    if (!context.source.trim()) {
        nova.workspace.showErrorMessage("ClaudeSynth: Nothing to work with — make a selection or open a file.");
        return;
    }

    var prompt = buildPrompt(context, mode);

    nova.workspace.showInformativeMessage("ClaudeSynth: Calling Claude...");

    callClaude(prompt, apiKey, model)
        .then(function(generated) {
            handleResponse(editor, generated, mode);
        })
        .catch(function(err) {
            nova.workspace.showErrorMessage("ClaudeSynth error: " + err.message);
            console.error("ClaudeSynth error:", err);
        });
}

// ─── Context resolution ───────────────────────────────────────────────────────

function resolveContext(editor) {
    var selection = editor.selectedRange;
    var language  = editor.document.syntax || "plaintext";

    if (selection.length > 0) {
        return {
            source:   editor.getTextInRange(selection),
            mode:     "selection",
            language: language,
            range:    selection
        };
    }

    // No selection — send the full document
    var fullRange = new Range(0, editor.document.length);
    return {
        source:   editor.getTextInRange(fullRange),
        mode:     "document",
        language: language,
        range:    fullRange
    };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(context, mode) {
    var languageNote = "You are an expert " + context.language + " engineer. Write clean, idiomatic " + context.language + " code.";

    var modeInstructions = {
        write: [
            "Your task: implement the following code based on its signature, comments, and context.",
            "Honor all argument types, return types, and doc comments exactly.",
            "Return ONLY the implementation — no prose, no markdown fences, no explanation.",
            "Write production-quality code. No placeholder TODOs."
        ].join("\n"),

        explode: [
            "Your task: analyze this code and determine if it should be decomposed.",
            "If the method or class has mixed concerns, does I/O, or has clear polymorphic consumers — extract a protocol and provide a concrete conforming type.",
            "If no abstraction is warranted, implement it directly and say why in a comment.",
            "Begin with: // CLAUDESYNTH: [DIRECT | EXPLODED] — one-line reason",
            "Return ONLY code. No markdown fences. No prose outside of comments."
        ].join("\n"),

        protocol: [
            "Your task: extract a clean protocol or interface from this concrete type.",
            "Include only the public contract — no implementation details.",
            "Then show the original type conforming to it.",
            "Return ONLY code. No markdown fences. No prose."
        ].join("\n"),

        explain: [
            "Your task: explain this code clearly for a developer unfamiliar with this codebase.",
            "Structure your response as:",
            "1. Purpose — one sentence.",
            "2. Contract — inputs, outputs, side effects.",
            "3. Key implementation decisions.",
            "4. Any red flags or suggestions.",
            "Write in plain English. Be direct and concise."
        ].join("\n")
    };

    return languageNote + "\n\n" +
        modeInstructions[mode] + "\n\n" +
        "Language: " + context.language + "\n\n" +
        "Code:\n" + context.source;
}

// ─── Claude API call ──────────────────────────────────────────────────────────

function callClaude(prompt, apiKey, model) {
    var lines   = prompt.split("\n\n");
    var system  = lines[0];
    var content = lines.slice(1).join("\n\n");

    return fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key":         apiKey,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json"
        },
        body: JSON.stringify({
            model:      model,
            max_tokens: 4096,
            system:     system,
            messages: [
                { role: "user", content: content }
            ]
        })
    })
    .then(function(response) {
        if (!response.ok) {
            return response.json().then(function(err) {
                throw new Error("Claude API " + response.status + ": " + (err.error && err.error.message ? err.error.message : response.statusText));
            });
        }
        return response.json();
    })
    .then(function(data) {
        var text = "";
        if (data.content && data.content.length > 0) {
            data.content.forEach(function(block) {
                if (block.type === "text") text += block.text;
            });
        }
        if (!text) throw new Error("Claude returned an empty response.");
        return text;
    });
}

// ─── Response handler ─────────────────────────────────────────────────────────

function handleResponse(editor, generated, mode) {
    // Strip any markdown fences the model added despite instructions
    var clean = generated
        .replace(/^```[\w]*\r?\n?/gm, "")
        .replace(/^```\r?$/gm, "")
        .trim();

    var insertMode = nova.config.get("claudesynth.insertMode") || "replace";

    // Explain and explode always open in a new document
    if (mode === "explain" || mode === "explode") {
        insertMode = "newDocument";
    }

    if (insertMode === "clipboard") {
        nova.clipboard.writeText(clean);
        nova.workspace.showInformativeMessage("ClaudeSynth: Response copied to clipboard.");
        return;
    }

    if (insertMode === "newDocument") {
        nova.workspace.openNewTextDocument({
            content: clean,
            syntax:  editor.document.syntax
        });
        return;
    }

    // Default: replace selection or insert at cursor
    editor.edit(function(e) {
        var sel = editor.selectedRange;
        if (sel.length > 0) {
            e.replace(sel, clean);
        } else {
            e.insert(sel.start, clean);
        }
    });
}