// A nested own-line comment needs a blank line above it, unlike the stock
// @stylistic/lines-around-comment, which also nags about top-level comments that
// we deliberately keep tight against the code they describe.
const OPENERS = new Set(["{", "[", "(", ":"]);

const rule = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    schema: [],
    messages: { missing: "Expected a blank line before this comment." },
  },
  create(context) {
    const source = context.sourceCode;
    const lines = source.lines;

    return {
      Program() {
        const comments = source.getAllComments();

        for (const comment of comments) {
          const line = comment.loc.start.line;
          const before = lines[line - 1].slice(0, comment.loc.start.column);
          if (before.trim() !== "" || line === 1) {
            continue;
          }

          if (lines[line - 2].trim() === "") {
            continue;
          }

          // Top-level comments sit directly in Program, so the innermost node is Program itself.
          if (source.getNodeByRangeIndex(comment.range[0])?.type === "Program") {
            continue;
          }

          const prevToken = source.getTokenBefore(comment, { includeComments: true });
          if (!prevToken) {
            continue;
          }

          if (prevToken.type === "Punctuator" && OPENERS.has(prevToken.value)) {
            continue;
          }

          // Comment runs stay together; only the first line of a run needs the gap.
          const isOwnLineComment =
            (prevToken.type === "Line" || prevToken.type === "Block") &&
            lines[prevToken.loc.start.line - 1].slice(0, prevToken.loc.start.column).trim() === "";
          if (isOwnLineComment && prevToken.loc.end.line === line - 1) {
            continue;
          }

          context.report({
            loc: comment.loc,
            messageId: "missing",
            fix: (fixer) => {
              const lineStart = comment.range[0] - comment.loc.start.column;

              return fixer.insertTextAfterRange([lineStart, lineStart], "\n");
            },
          });
        }
      },
    };
  },
};

export default { meta: { name: "spacing" }, rules: { "blank-line-before-nested-comment": rule } };
