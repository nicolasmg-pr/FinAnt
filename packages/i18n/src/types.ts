import type { Resources } from './en';

/** Same key structure as English, but every leaf is a plain string. A missing or
 * extra key in a translation is then a compile error rather than a blank label. */
type Stringify<T> = { [K in keyof T]: T[K] extends string ? string : Stringify<T[K]> };

export type Translations = Stringify<Resources>;
