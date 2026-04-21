/**
 * Express 5's `ParamsDictionary` widens path params to `string | string[]`
 * for defensive compatibility — even though Router-bound `:id`-style params
 * are always `string` at runtime. This helper narrows the raw param access
 * to the runtime invariant (first string if an array leaks through, empty
 * string on absence) so downstream callers can rely on a plain `string`.
 *
 * Used by admin routes that read typed path params.
 */

export function pickParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return value ?? '';
}

export function pickParamOrNull(value: string | string[] | undefined): string | null {
  const picked = pickParam(value);
  return picked === '' ? null : picked;
}
