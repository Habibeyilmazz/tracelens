import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mdToHtml } from '../src/mdhtml.js';

test('markdown: paragraphs, line breaks, headings and inline spans', () => {
  assert.equal(mdToHtml('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>');
  assert.equal(mdToHtml('## Plan ##'), '<p class="mh">Plan</p>');
  assert.equal(mdToHtml('**bold**, *it*, `a*b*c` and 2 * 3 * 4'), '<p><strong>bold</strong>, <em>it</em>, <code>a*b*c</code> and 2 * 3 * 4</p>');
  assert.equal(mdToHtml('snake_case_name stays'), '<p>snake_case_name stays</p>');
});

test('markdown: untrusted text is escaped everywhere', () => {
  const evil = '<script>alert(1)</script> <img src=x onerror=alert(1)>';
  for (const md of [evil, `# ${evil}`, `- ${evil}`, `> ${evil}`, '```\n' + evil + '\n```', `a | b\n--|--\n${evil} | \`${evil}\``, `**${evil}**`]) {
    const html = mdToHtml(md);
    assert.ok(!/<script|<img/i.test(html), html);
    assert.ok(html.includes('&lt;script&gt;'), html);
  }
});

test('markdown: only http(s) links become anchors, images are never loaded', () => {
  assert.equal(mdToHtml('[docs](https://example.com/a?b=1&c=2)'), '<p><a href="https://example.com/a?b=1&amp;c=2" rel="noreferrer">docs</a></p>');
  assert.equal(mdToHtml('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(mdToHtml('[x](https://a.test/"onmouseover="alert(1))'), '<p><a href="https://a.test/&quot;onmouseover=&quot;alert(1" rel="noreferrer">x</a>)</p>');
  assert.equal(mdToHtml('![diagram](https://tracker.test/pixel.png)'), '<p>diagram</p>');
});

test('markdown: fenced code is kept verbatim, an unclosed fence runs to the end', () => {
  assert.equal(mdToHtml('Run:\n```sh\nnpm test -- **x**\n```\nDone.'), '<p>Run:</p><pre><code>npm test -- **x**</code></pre><p>Done.</p>');
  assert.equal(mdToHtml('~~~\na\n\nb'), '<pre><code>a\n\nb</code></pre>');
  assert.equal(mdToHtml('````\n```\ninner\n```\n````'), '<pre><code>```\ninner\n```</code></pre>');
});

test('markdown: lists, nesting, ordered start, quotes, rules', () => {
  assert.equal(mdToHtml('- a\n- b\n  - c\n- d'), '<ul><li>a</li><li>b<ul><li>c</li></ul></li><li>d</li></ul>');
  assert.equal(mdToHtml('3. three\n4. four'), '<ol start="3"><li>three</li><li>four</li></ol>');
  assert.equal(mdToHtml('Changes:\n- one\n\nAfter.'), '<p>Changes:</p><ul><li>one</li></ul><p>After.</p>');
  assert.equal(mdToHtml('1. step\n   ```\n   code\n   ```'), '<ol><li>step<pre><code>code</code></pre></li></ol>');
  assert.equal(mdToHtml('- a\n\n  more\n- b'), '<ul><li><p>a</p><p>more</p></li><li>b</li></ul>');
  assert.equal(mdToHtml('> quoted\n> **text**'), '<blockquote><p>quoted<br><strong>text</strong></p></blockquote>');
  assert.equal(mdToHtml('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>');
});

test('markdown: pipe tables, with escaped pipes and short rows', () => {
  assert.equal(
    mdToHtml('| File | Change |\n|---|:--:|\n| `a\\|b` | x |\n| c |'),
    '<div class="scroll"><table><thead><tr><th>File</th><th>Change</th></tr></thead><tbody><tr><td><code>a|b</code></td><td>x</td></tr><tr><td>c</td><td></td></tr></tbody></table></div>',
  );
  assert.equal(mdToHtml('a | b\n---'), '<p>a | b</p><hr>');
});

test('markdown: large input renders in linear time', () => {
  for (const deep of ['>'.repeat(100_000) + ' x', Array.from({ length: 5000 }, (_, k) => ' '.repeat(k * 2) + '- x').join('\n')])
    assert.match(mdToHtml(deep), /x/);
  const big = '*a '.repeat(50_000) + '\n' + '- x\n'.repeat(20_000) + '`'.repeat(10_000);
  const t = Date.now();
  mdToHtml(big);
  assert.ok(Date.now() - t < 2000);
});
