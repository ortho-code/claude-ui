import MarkdownIt from 'markdown-it';

/**
 * Claude's replies as HTML that is safe to put in the window.
 * A reply is untrusted text — claude quotes web pages, files and tool output — so raw HTML in it is shown as text and never parsed as markup (`html: false`), and markdown-it's own link check refuses `javascript:`, `vbscript:`, `file:` and non-image `data:` links, bare URLs included.
 * Images are not rendered at all: the window's CSP would refuse a remote one anyway and leave a broken icon, and a reply's image is never the point.
 * The CSP (`default-src 'self'`) is the second layer: no script runs even if something got through.
 * A line break inside a paragraph stays a line break (`breaks: true`), as the request above it keeps one; CommonMark's default joins the lines, which suits prose wrapped at a fixed width and runs a reply written a sentence to a line into one block.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: true });
md.disable('image');

export function renderMarkdown(text: string): string {
  return md.render(text);
}
