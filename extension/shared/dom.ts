/** Every page here ships with its own markup, so a missing node is a build mistake. */
export function element<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}
