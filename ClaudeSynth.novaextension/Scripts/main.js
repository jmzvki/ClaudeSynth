var compositeDisposable = null;

exports.activate = function () {
  compositeDisposable = new CompositeDisposable();

  compositeDisposable.add(
    nova.commands.register("claudesynth.write", function (editor) {
      runCommand(editor, "write");
    }),
  );

  compositeDisposable.add(
    nova.commands.register("claudesynth.explode", function (editor) {
      runCommand(editor, "explode");
    }),
  );

  compositeDisposable.add(
    nova.commands.register("claudesynth.protocol", function (editor) {
      runCommand(editor, "protocol");
    }),
  );

  compositeDisposable.add(
    nova.commands.register("claudesynth.explain", function (editor) {
      runCommand(editor, "explain");
    }),
  );

  console.log("ClaudeSynth activated.");
};

exports.deactivate = function () {
  if (compositeDisposable) {
    compositeDisposable.dispose();
    compositeDisposable = null;
  }
};

// ─── Main pipeline ────────────────────────────────────────────────────────────

function runCommand(editor, mode) {
  var apiKey = nova.config.get("claudesynth.apiKey");
  var model = nova.config.get("claudesynth.model") || "claude-sonnet-4-5";

  if (!apiKey) {
    nova.workspace.showErrorMessage(
      "ClaudeSynth: No API key set. Add it in Extensions → ClaudeSynth Preferences.",
    );
    return;
  }

  var modeLabels = {
    write: "Write / Implement",
    explode: "Explode / Abstract",
    protocol: "Generate Protocol",
    explain: "Explain Selection",
  };

  nova.workspace.showInputPanel(
    "ClaudeSynth — " + modeLabels[mode],
    {
      label: "Instructions (optional)",
      placeholder:
        "e.g. add null checking, make it async, handle edge cases...",
      prompt: "Generate",
    },
    function (userInput) {
      // Cancelled
      if (userInput === null) return;

      var context = resolveContext(editor);
      if (!context) return;

      if (!context.source.trim()) {
        nova.workspace.showErrorMessage(
          "ClaudeSynth: Nothing to work with — make a selection or open a file.",
        );
        return;
      }

      var prompt = buildPrompt(context, mode, userInput);

      nova.workspace.showInformativeMessage("ClaudeSynth: Thinking...");

      callClaude(prompt, apiKey, model)
        .then(function (generated) {
          handleResponse(editor, generated, mode, context);
        })
        .catch(function (err) {
          nova.workspace.showErrorMessage("ClaudeSynth error: " + err.message);
          console.error("ClaudeSynth error:", err);
        });
    },
  );
}

// ─── Context / scope resolution ───────────────────────────────────────────────

function resolveContext(editor) {
  var language = editor.document.syntax || "plaintext";
  var sel = editor.selectedRange;

  // 1. Explicit selection always wins
  if (sel.length > 0) {
    return {
      source: editor.getTextInRange(sel),
      mode: "selection",
      language: language,
      range: sel,
    };
  }

  // 2. Python — scope detection not supported yet
  if (language === "python") {
    nova.workspace.showInformativeMessage(
      "ClaudeSynth: Python scope detection coming soon — please make a selection.",
    );
    return null;
  }

  console.log("ClaudeSynth: attempting scope resolution...");

  // 3. Walk the document to find enclosing scope
  var fullRange = new Range(0, editor.document.length);
  var fullText = editor.getTextInRange(fullRange);
  var cursor = sel.start;

  var scope = findEnclosingScope(fullText, cursor, language);

  if (scope) {
    console.log(
      "ClaudeSynth: scope.start=" +
        scope.start +
        " scope.end=" +
        scope.end +
        " kind=" +
        scope.kind,
    );

    var range = new Range(scope.start, scope.end);

    return {
      source: fullText.slice(scope.start, scope.end),
      mode: scope.kind,
      language: language,
      range: range,
    };
  }

  // 4. Full document fallback
  console.log(
    "ClaudeSynth: falling back to full document, fullText.length=" +
      fullText.length,
  );

  var docRange = new Range(0, fullText.length);
  return {
    source: fullText,
    mode: "document",
    language: language,
    range: docRange,
  };
}

// ─── Scope detection ──────────────────────────────────────────────────────────

function findEnclosingScope(text, cursor, language) {
  var patterns = getScopePatterns(language);
  var kinds = ["method", "type"];

  for (var k = 0; k < kinds.length; k++) {
    var kind = kinds[k];
    var kindPatterns = patterns[kind];
    if (!kindPatterns) continue;

    var bestStart = -1;

    for (var p = 0; p < kindPatterns.length; p++) {
      var regex = new RegExp(kindPatterns[p], "gm");
      var m;
      while ((m = regex.exec(text)) !== null) {
        if (m.index < cursor && m.index > bestStart) {
          bestStart = m.index;
        }
      }
    }

    if (bestStart === -1) continue;

    var scopeEnd = findClosingBrace(text, bestStart);

    if (scopeEnd !== -1 && cursor <= scopeEnd) {
      return { start: bestStart, end: scopeEnd, kind: kind };
    }
  }

  return null;
}

function findClosingBrace(text, from) {
  var depth = 0;
  var i = from;

  // Skip forward until we find the first opening brace
  while (i < text.length && text[i] !== "{") {
    i++;
  }

  if (i >= text.length) return -1;

  var inString = false;
  var strChar = "";

  for (; i < text.length; i++) {
    var ch = text[i];
    var prev = i > 0 ? text[i - 1] : "";

    if (inString) {
      if (ch === strChar && prev !== "\\") inString = false;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      strChar = ch;
      continue;
    }

    // Skip single-line comments
    if (ch === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

// ─── Scope patterns per language ──────────────────────────────────────────────

function getScopePatterns(language) {
  var patterns = {
    swift: {
      method: [
        "(?:(?:private|public|internal|fileprivate|open|static|class|override|mutating|async|throws)\\s+)*func\\s+\\w+",
        "(?:convenience\\s+|required\\s+)?init[?!]?\\s*[(<]",
      ],
      type: [
        "(?:final\\s+)?(?:class|struct|enum|actor|protocol)\\s+\\w+",
        "extension\\s+\\w+",
      ],
    },

    javascript: {
      method: [
        "(?:async\\s+)?function\\s*\\*?\\s*\\w+\\s*\\(",
        "(?:static\\s+)?(?:async\\s+)?(?:get\\s+|set\\s+)?\\w+\\s*\\([^)]*\\)\\s*\\{",
      ],
      type: ["class\\s+\\w+"],
    },

    typescript: {
      method: [
        "(?:public|private|protected|static|async|abstract|override)\\s+(?:async\\s+)?\\w+\\s*[(<]",
        "(?:async\\s+)?function\\s*\\*?\\s*\\w+\\s*[(<]",
      ],
      type: [
        "(?:export\\s+)?(?:abstract\\s+)?class\\s+\\w+",
        "(?:export\\s+)?interface\\s+\\w+",
      ],
    },

    php: {
      method: [
        "(?:public|protected|private|static|abstract|final)\\s+(?:static\\s+)?function\\s+\\w+",
        "function\\s+\\w+",
      ],
      type: [
        "(?:abstract\\s+|final\\s+)?class\\s+\\w+",
        "interface\\s+\\w+",
        "trait\\s+\\w+",
      ],
    },

    java: {
      method: [
        "(?:public|private|protected|static|final|abstract|synchronized)\\s+(?:\\w+\\s+)+\\w+\\s*\\(",
      ],
      type: [
        "(?:public|private|protected)\\s+(?:abstract\\s+|final\\s+)?(?:class|interface|enum)\\s+\\w+",
      ],
    },

    kotlin: {
      method: [
        "(?:private|public|protected|internal|override|suspend|inline|open|abstract)\\s+fun\\s+\\w+",
        "fun\\s+\\w+",
      ],
      type: [
        "(?:data\\s+|sealed\\s+|abstract\\s+|open\\s+)?(?:class|interface|object|enum class)\\s+\\w+",
      ],
    },
  };

  // Default to JavaScript patterns for unknown languages
  return patterns[language] || patterns["javascript"];
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(context, mode, userInput) {
  var scopeNote =
    {
      selection: "The developer selected this specific block.",
      method: "This is the enclosing method/function at the cursor.",
      type: "This is the enclosing class/type at the cursor.",
      document: "This is the full document.",
    }[context.mode] || "";

  var languageNote =
    "You are an expert " +
    context.language +
    " engineer. Write clean, idiomatic " +
    context.language +
    " code.";

  var modeInstructions = {
    write: [
      "Your task: implement the following code based on its signature, comments, and context.",
      "Honor all argument types, return types, and doc comments exactly.",
      "Return ONLY the implementation — no prose, no markdown fences, no explanation.",
      "Write production-quality code. No placeholder TODOs.",
    ].join("\n"),

    explode: [
      "Your task: analyze this code and determine if it should be decomposed.",
      "If the method or class has mixed concerns, does I/O, or has clear polymorphic consumers — extract a protocol and provide a concrete conforming type.",
      "If no abstraction is warranted, implement it directly and say why in a comment.",
      "Begin with: // CLAUDESYNTH: [DIRECT | EXPLODED] — one-line reason",
      "Return ONLY code. No markdown fences. No prose outside of comments.",
    ].join("\n"),

    protocol: [
      "Your task: extract a clean protocol or interface from this concrete type.",
      "Include only the public contract — no implementation details.",
      "Then show the original type conforming to it.",
      "Return ONLY code. No markdown fences. No prose.",
    ].join("\n"),

    explain: [
      "Your task: explain this code clearly for a developer unfamiliar with this codebase.",
      "Structure your response as:",
      "1. Purpose — one sentence.",
      "2. Contract — inputs, outputs, side effects.",
      "3. Key implementation decisions.",
      "4. Any red flags or suggestions.",
      "Write in plain English. Be direct and concise.",
    ].join("\n"),
  };

  var extraInstructions =
    userInput && userInput.trim()
      ? "\n\nAdditional instructions from the developer:\n" + userInput.trim()
      : "";

  return (
    languageNote +
    "\n\n" +
    modeInstructions[mode] +
    "\n\n" +
    "Language: " +
    context.language +
    "\n" +
    "Scope: " +
    scopeNote +
    extraInstructions +
    "\n\n" +
    "Code:\n" +
    context.source
  );
}

// ─── Claude API call ──────────────────────────────────────────────────────────

function callClaude(prompt, apiKey, model) {
  var lines = prompt.split("\n\n");
  var system = lines[0];
  var content = lines.slice(1).join("\n\n");

  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 4096,
      system: system,
      messages: [{ role: "user", content: content }],
    }),
  })
    .then(function (response) {
      if (!response.ok) {
        return response.json().then(function (err) {
          throw new Error(
            "Claude API " +
              response.status +
              ": " +
              (err.error && err.error.message
                ? err.error.message
                : response.statusText),
          );
        });
      }
      return response.json();
    })
    .then(function (data) {
      var text = "";
      if (data.content && data.content.length > 0) {
        data.content.forEach(function (block) {
          if (block.type === "text") text += block.text;
        });
      }
      if (!text) throw new Error("Claude returned an empty response.");
      return text;
    });
}

// ─── Response handler ─────────────────────────────────────────────────────────

function handleResponse(editor, generated, mode, context) {
  var clean = generated
    .replace(/^```[\w]*\r?\n?/gm, "")
    .replace(/^```\r?$/gm, "")
    .trim();

  // If replacing a scoped range, Claude includes closing brace — strip it
  if (mode === "write" && context.mode === "method") {
    clean = clean.replace(/\}\s*$/, "").trimEnd();
  }

  var insertMode = nova.config.get("claudesynth.insertMode") || "replace";

  // Explain and explode always open in a new document
  if (mode === "explain" || mode === "explode") {
    insertMode = "newDocument";
  }

  if (insertMode === "clipboard") {
    nova.clipboard.writeText(clean);
    nova.workspace.showInformativeMessage(
      "ClaudeSynth: Response copied to clipboard.",
    );
    return;
  }

  if (insertMode === "newDocument") {
    nova.workspace.openNewTextDocument({
      content: clean,
      syntax: editor.document.syntax,
    });
    return;
  }

  // Replace the resolved scope range, not just the selection
  editor.edit(function (e) {
    if (context.range && context.mode !== "document") {
      e.replace(context.range, clean);
    } else {
      var sel = editor.selectedRange;
      if (sel.length > 0) {
        e.replace(sel, clean);
      } else {
        e.insert(sel.start, clean);
      }
    }
  });
}
