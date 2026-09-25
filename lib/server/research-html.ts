import { parse, type DefaultTreeAdapterTypes } from 'parse5'

/** Research-only text evidence from already byte-capped HTML. This parser never
 * loads resources or executes scripts. It discards unfinished tags and excludes
 * raw script/style/head/template content, including payloads cut off at EOF.
 * This is text-node evidence, not a browser render or CSS visibility test.
 */
export function extractResearchHtml(html: string): { text: string; title: string } {
  const document = parse(html, { scriptingEnabled: false })
  const pending: { node: DefaultTreeAdapterTypes.Node; inHead: boolean }[] =
    [{ node: document, inHead: false }]
  const text: string[] = []
  let title = ''
  while (pending.length) {
    const { node, inHead } = pending.pop()!
    if ('tagName' in node) {
      if (['script', 'style', 'template'].includes(node.tagName)) continue
      if (node.tagName === 'title') {
        if (!title) title = node.childNodes
          .filter((child): child is DefaultTreeAdapterTypes.TextNode => 'value' in child)
          .map(child => child.value).join(' ').replace(/\s+/g, ' ').trim().slice(0, 8000)
        continue
      }
    }
    if ('value' in node && !inHead) text.push(node.value)
    if ('childNodes' in node) {
      const nextHead = inHead || ('tagName' in node && node.tagName === 'head')
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        pending.push({ node: node.childNodes[i], inHead: nextHead })
      }
    }
  }
  return { text: text.join(' ').replace(/\s+/g, ' ').trim().slice(0, 50_000), title }
}
