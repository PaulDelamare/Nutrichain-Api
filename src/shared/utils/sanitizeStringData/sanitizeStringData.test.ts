import { expect, describe, it } from 'vitest';
import { sanitizeDataWithHtml } from './sanitizeStringData';

describe('sanitizeDataWithHtml', () => {
  it('should sanitize HTML by removing disallowed tags', () => {
    const input = {
      title: '<h1>Title</h1>',
      description: '<p>Description <a href="#">link</a></p>',
    };
    const allowedTags = ['p', 'a'];
    const allowedAttributes = { a: ['href'] };

    const result = sanitizeDataWithHtml(input, allowedTags, allowedAttributes);

    expect(result.title).toBe('Title');
    expect(result.description).toBe('<p>Description <a href="#">link</a></p>');
  });

  it('should remove all HTML tags if no allowed tags are specified', () => {
    const input = {
      title: '<h1>Title</h1>',
      content: '<div>Some <strong>content</strong></div>',
    };

    const result = sanitizeDataWithHtml(input, []);

    expect(result.title).toBe('Title');
    expect(result.content).toBe('Some content');
  });

  it('should keep allowed attributes on tags', () => {
    const input = {
      description: '<a href="https://example.com" target="_blank">Click here</a>',
    };
    const allowedTags = ['a'];
    const allowedAttributes = {
      a: ['href', 'target'],
    };

    const result = sanitizeDataWithHtml(input, allowedTags, allowedAttributes);

    expect(result.description).toBe('<a href="https://example.com" target="_blank">Click here</a>');
  });

  it('should ignore non-string fields', () => {
    const input = {
      name: 'John',
      age: 30,
      description: '<p>Valid HTML</p>',
    };
    const allowedTags = ['p'];

    const result = sanitizeDataWithHtml(input, allowedTags);

    expect(result.age).toBe(30);
    expect(result.description).toBe('<p>Valid HTML</p>');
  });
});
