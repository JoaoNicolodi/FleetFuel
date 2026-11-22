/**
 * Tipo Result<S, E> para tratamento funcional de erros.
 * O domínio NUNCA lança exceções para erros de negócio: ele os RETORNA.
 * Exceções ficam reservadas para falhas de infraestrutura (banco caiu, etc).
 */
export type Ok<S> = { readonly ok: true; readonly value: S };
export type Fail<E> = { readonly ok: false; readonly error: E };
export type Result<S, E> = Ok<S> | Fail<E>;

export const ok = <S>(value: S): Ok<S> => ({ ok: true, value });
export const fail = <E>(error: E): Fail<E> => ({ ok: false, error });

export const isOk = <S, E>(r: Result<S, E>): r is Ok<S> => r.ok;
export const isFail = <S, E>(r: Result<S, E>): r is Fail<E> => !r.ok;

/** Aplica uma função ao valor de sucesso, propagando o erro sem alteração. */
export const map = <S, E, T>(r: Result<S, E>, fn: (s: S) => T): Result<T, E> =>
  r.ok ? ok(fn(r.value)) : r;

/** Encadeia operações que também retornam Result (flatMap). */
export const andThen = <S, E, T, F>(
  r: Result<S, E>,
  fn: (s: S) => Result<T, F>,
): Result<T, E | F> => (r.ok ? fn(r.value) : r);

/**
 * Combina vários Results: devolve todos os valores ou o PRIMEIRO erro.
 * Útil para validar vários Value Objects de uma vez.
 */
export const combine = <T extends readonly Result<unknown, unknown>[]>(
  results: T,
): Result<
  { [K in keyof T]: T[K] extends Result<infer S, unknown> ? S : never },
  T[number] extends Result<unknown, infer E> ? E : never
> => {
  const values: unknown[] = [];
  for (const r of results) {
    if (!r.ok) return r as never;
    values.push(r.value);
  }
  return ok(values) as never;
};
