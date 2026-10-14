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
