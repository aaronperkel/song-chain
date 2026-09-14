/**
 * Inflections Porter 1 handles asymmetrically.
 *
 * Porter's step 1c rewrites a terminal `y` to `i` only when the preceding
 * stem already contains a vowel, so `story` and `stories` both reach `stori`,
 * but `cries` reaches `cri` while `cry` stays `cry`. Monosyllables are the
 * whole affected class -- cry, try, fly, dry, spy -- and they are exactly the
 * words song titles are made of.
 *
 * Like the g-drop pass, this is an extra *key*, never a replacement: the
 * literal form is always kept too.
 */
export function yVariant(norm: string): string | null {
  if (!/^[a-z]{2,}y$/.test(norm)) return null
  return `${norm.slice(0, -1)}i`
}
