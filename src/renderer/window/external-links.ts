/**
 * Send every link clicked inside `root` to the OS browser, and never let one navigate the window.
 * Main refuses a navigation of the window and a new window of its own anyway, so without this a link would do nothing; both are stopped here as well, and `open` is given the link only when it is http(s), which main checks again.
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
