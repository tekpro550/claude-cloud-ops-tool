/** Replaces every $VARIABLE_NAME token with variables[VARIABLE_NAME], or leaves it untouched if that key isn't provided. */
export function renderNotificationTemplate(
  body: string,
  variables: Record<string, string>,
): string {
  return body.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(variables, name)
      ? variables[name]
      : match,
  );
}
