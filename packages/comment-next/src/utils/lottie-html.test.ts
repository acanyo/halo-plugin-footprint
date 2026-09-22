// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { sanitizeCommentHtml, sanitizeCommentSubmitHtml } from './html';
import { upgradeLottieImages } from './lottie-html';

function fragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Lottie comment source policy', () => {
  it.each(['json', 'tgs', 'lottie'])(
    'allows the supported .%s format only for an exact configured HTTPS host',
    (format) => {
      const safeHtml = sanitizeCommentHtml(
        `<img src="https://cdn.example.com/wave.${format}?token=abc">`,
        [{ host: 'CDN.Example.com.:443' }]
      );
      const lottie = fragment(safeHtml).querySelector('halo-lottie');

      expect(lottie?.getAttribute('src')).toBe(
        `https://cdn.example.com/wave.${format}?token=abc`
      );
      expect(lottie?.getAttribute('format')).toBe(format);
    }
  );

  it.each([
    'https://sub.cdn.example.com/wave.lottie',
    'https://cdn.example.com.evil.test/wave.lottie',
    'https://cdn.example.com:8443/wave.lottie',
    'http://cdn.example.com/wave.lottie',
    'https://user@cdn.example.com/wave.lottie',
  ])('blocks unsafe or non-exact external source %s', (source) => {
    const safeHtml = sanitizeCommentHtml(
      `<img src="${source}" title="comment-next-lottie:format=lottie">`,
      [{ host: 'cdn.example.com' }]
    );

    expect(fragment(safeHtml).querySelector('img, halo-lottie')).toBeNull();
  });

  it('does not treat legacy marker metadata as authorization', () => {
    const safeHtml = sanitizeCommentHtml(
      '<img src="https://evil.example/wave.lottie?comment-next-lottie=1&format=lottie">'
    );

    expect(fragment(safeHtml).querySelector('img, halo-lottie')).toBeNull();
  });

  it('allows same-origin plugin content and preserves its declared format', () => {
    const submitted = sanitizeCommentSubmitHtml(
      '<halo-lottie src="/apis/api.lottie.halo.run/v1alpha1/animations/wave/content" ' +
        'format="tgs" width="640" height="320"></halo-lottie>'
    );
    const storedImage = fragment(submitted).querySelector('img');

    expect(storedImage?.getAttribute('src')).toBe(
      `${window.location.origin}/apis/api.lottie.halo.run/v1alpha1/animations/wave/content`
    );
    expect(storedImage?.getAttribute('title')).toContain('format=tgs');

    const displayed = sanitizeCommentHtml(submitted);
    expect(
      fragment(displayed).querySelector('halo-lottie')?.getAttribute('format')
    ).toBe('tgs');
  });

  it('removes only legacy Lottie parameters and preserves unrelated query data', () => {
    const safeHtml = sanitizeCommentHtml(
      '<img src="https://cdn.example.com/wave.lottie?token=abc&comment-next-lottie=1&format=tgs&width=99">',
      [{ host: 'cdn.example.com' }]
    );
    const lottie = fragment(safeHtml).querySelector('halo-lottie');

    expect(lottie?.getAttribute('src')).toBe(
      'https://cdn.example.com/wave.lottie?token=abc'
    );
    expect(lottie?.getAttribute('format')).toBe('tgs');
    expect(lottie?.getAttribute('width')).toBe('99');
  });

  it('leaves ordinary images intact', () => {
    const safeHtml = sanitizeCommentHtml(
      '<img src="https://images.example.com/photo.png" alt="photo">'
    );

    expect(fragment(safeHtml).querySelector('img')?.getAttribute('alt')).toBe(
      'photo'
    );
  });
});

describe('Lottie content adapter', () => {
  it('removes blocked stored animation images', () => {
    document.body.innerHTML =
      '<img src="https://evil.example/wave.lottie" title="comment-next-lottie:format=lottie">';

    expect(upgradeLottieImages(document.body)).toBe(false);
    expect(document.body.querySelector('img, halo-lottie')).toBeNull();
  });

  it('upgrades allowed images and limits their rendered dimensions', () => {
    document.body.innerHTML =
      '<img src="https://cdn.example.com/wave.lottie" width="400" height="200">';

    expect(
      upgradeLottieImages(document.body, [{ host: 'cdn.example.com' }], {
        maxWidth: 100,
        maxHeight: 100,
      })
    ).toBe(true);
    const lottie = document.body.querySelector('halo-lottie');
    expect(lottie?.getAttribute('width')).toBe('100');
    expect(lottie?.getAttribute('height')).toBe('50');
  });
});
