import MarkdownIt from 'markdown-it';

/**
 * Claude's replies as HTML that is safe to put in the window.
 * A reply is untrusted text — claude quotes web pages, files and tool output — so raw HTML in it is shown as text and never parsed as markup (`html: false`), and markdown-it's own link check refuses `javascript:`, `vbscript:`, `file:` and non-image `data:` links, bare URLs included.
 * Images are not rendered at all: the window's CSP would refuse a remote one anyway and leave a broken icon, and a reply's image is never the point.
 * The CSP (`default-src 'self'`) is the second layer: no script runs even if something got through.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });
md.disable('image');

export function renderMarkdown(text: string): string {
  return md.render(text);
}

/**
 * Send every link clicked inside `root` to the OS browser, and never let one navigate the window.
 * A navigation would replace the app with the page, and a middle-click would open it in a new window of the app's own; both are stopped here, and `open` is given the link only when it is http(s), which main checks again.
 */
export function routeLinks(root: HTMLElement, open: (url: string) => void): void {
  const handle = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || !root.contains(link)) return;
    event.preventDefault();
    if (event.type === 'auxclick' && event.button !== 1) return;
    const href = link.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) open(href);
  };
  root.addEventListener('click', handle);
  root.addEventListener('auxclick', handle);
}
