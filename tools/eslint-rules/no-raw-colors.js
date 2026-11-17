// Local ESLint rule: reject raw colours so the single theme file stays the only source of colour.
// Rejects Tailwind default-palette classes (bg-red-500, text-white ...), arbitrary colour values
// (bg-[#fff], text-[oklch(...)]) and whole-string colour literals ('#ff0000', 'rgb(...)').

const PALETTE =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white';
const UTILITY =
  'bg|text|border|border-[xytblrse]|ring|ring-offset|fill|stroke|from|via|to|outline|divide|accent|caret|decoration|shadow|placeholder|inset-shadow|inset-ring|drop-shadow';

const PALETTE_CLASS = new RegExp(
  `(?:^|[\\s:!-])(?:${UTILITY})-(?:${PALETTE})(?:-\\d{1,3})?(?![\\w-])`,
);
const ARBITRARY_COLOUR =
  /\[(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\()/i;
const COLOUR_LITERAL =
  /^\s*(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([^)]*\))\s*$/i;

/** @param {string} text */
export function findRawColour(text) {
  if (PALETTE_CLASS.test(text)) return 'palette class';
  if (ARBITRARY_COLOUR.test(text)) return 'arbitrary colour value';
  if (COLOUR_LITERAL.test(text)) return 'colour literal';
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noRawColors = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      raw: 'Raw colour ({{kind}}). Use a semantic token from apps/web/src/styles/theme.css (e.g. bg-surface, text-fg, border-line).',
    },
  },
  create(context) {
    /** @param {import('estree').Node} node @param {string} value */
    function check(node, value) {
      const kind = findRawColour(value);
      if (kind) context.report({ node, messageId: 'raw', data: { kind } });
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        if (typeof node.value.cooked === 'string') check(node, node.value.cooked);
      },
    };
  },
};

export default noRawColors;
