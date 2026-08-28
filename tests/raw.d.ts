/**
 * Vite's `?raw` suffix imports a file's contents as a string.
 *
 * Used so the popup integration test loads the real `popup.html` instead of a
 * copy that would silently drift from it. There is no `@types/node` in this
 * project (and no reason to add one just to read a file).
 */
declare module '*?raw' {
  const content: string
  export default content
}
