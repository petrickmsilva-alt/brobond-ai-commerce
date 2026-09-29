export type VariableValue = string | number | boolean | null | undefined;
export type VariableContext = Readonly<Record<string, VariableValue>>;

/**
 * Replace `{{variable}}` tokens without code execution.
 * Unknown variables remain visible so malformed templates can be detected,
 * while nullish values intentionally render as an empty string.
 */
export function replaceVariables(template: string, context: VariableContext): string {
  if (typeof template !== "string") throw new TypeError("Template must be a string.");

  return template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (token, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(context, key)) return token;
    const value = context[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

/** Returns unresolved tokens, useful when validating a template before saving it. */
export function unresolvedVariables(content: string): string[] {
  return [...content.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)].map((match) => match[1]!);
}
