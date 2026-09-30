import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../../../src/renderer/history/markdown';

// A reply is untrusted text: these pin that nothing in one becomes markup, a script, a remote load or a dangerous link.
describe('renderMarkdown', () => {
  it('renders what claude writes: paragraphs, lists, code blocks, inline code, tables', () => {
    const html = renderMarkdown('Done.\n\n- one\n- two\n\n```php\nfinal class X {}\n```\n\nUse `phpcs`.\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<p>Done.</p>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<pre><code class="language-php">final class X {}');
    expect(html).toContain('<code>phpcs</code>');
    expect(html).toContain('<table>');
  });

  it('shows raw HTML as text', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> and <b>bold</b>');
    expect(html).not.toMatch(/<script|<img|<b>/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('links http(s), written or bare', () => {
    expect(renderMarkdown('[the PR](https://github.com/o/r/pull/1)')).toContain('<a href="https://github.com/o/r/pull/1">the PR</a>');
    expect(renderMarkdown('see https://example.com/x')).toContain('<a href="https://example.com/x">');
  });

  it.each(['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'data:text/html,<script>alert(1)</script>'])('refuses a %s link', (url) => {
    expect(renderMarkdown(`[x](${url})`)).not.toContain('<a ');
  });

  it('does not render images, so nothing is loaded from anywhere', () => {
    const html = renderMarkdown('![chart](https://example.com/c.png)');
    expect(html).not.toContain('<img');
  });
});
