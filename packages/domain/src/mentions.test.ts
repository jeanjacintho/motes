import { describe, expect, it } from 'vitest';
import { parseMentions } from './mentions.js';

describe('parseMentions', () => {
  it.each([
    ['a plain mention', 'Olha isso @dev', ['dev']],
    ['at the start of the text', '@dev corrige', ['dev']],
    ['several, in order of appearance', '@qa depois @dev e @support-2', ['qa', 'dev', 'support-2']],
    ['the same bot twice', '@dev @dev, @dev!', ['dev']],
    ['punctuation right after', '(@dev), @qa; @ops: @x?', ['dev', 'qa', 'ops', 'x']],
    ['the end of a sentence', 'Fala com @dev.', ['dev']],
    ['a list item', '- pedir ao @dev\n- e ao @qa', ['dev', 'qa']],
    ['indented code nested in a list item', '- example:\n\n      @dev', []],
    ['indented code nested in a numbered item', '1. example:\n\n       @dev', []],
    ['a mention split by a code span', '@de`example`v', ['de']],
    ['a paragraph aligned with a nested item', '- parent\n    - child\n\n      @dev', ['dev']],
    ['indented code under a nested list item', '- parent\n    - child\n\n          @dev', []],
    [
      'indented code after returning to the parent item',
      '- parent\n    - child\n\n    parent paragraph\n\n      @dev',
      [],
    ],
    [
      'a paragraph after a lazy continuation',
      '- parent\n    - child\n    continuation\n\n      @dev',
      ['dev'],
    ],
    ['a sibling item after a nested one', '- a\n    - b\n- c @dev', ['dev']],
    [
      'indented code after a heading that closes a child item',
      '- parent\n    - child\n  # Parent heading\n\n      @dev',
      [],
    ],
    ['a continuation indented only two columns', '- item\n\n  continua com @dev', ['dev']],
    ['a paragraph indented four columns in an item', '- item\n\n    please @dev', ['dev']],
    ['the mention on the item line itself', '- item @dev\n\n      codigo', ['dev']],
    ['emphasis around it', '**@dev** e *@qa*', ['dev', 'qa']],
    ['underscore emphasis around it', 'chama _@dev_ agora', ['dev']],
    ['windows line endings', 'a\r\n@dev\r\nb', ['dev']],
  ])('finds %s', (_name, text, expected) => {
    expect(parseMentions(text)).toEqual(expected);
  });

  it.each([
    ['an email address', 'escreva para jean@dev.com'],
    ['a handle inside a word', 'foo@dev'],
    ['a domain after it', '@dev.com é o site'],
    ['an uppercase name', '@Dev e @DEV'],
    ['a name with an underscore', '@dev_bot'],
    ['an escaped at sign', 'use \\@dev para citar'],
    ['a bare at sign', '@ dev e @'],
    ['a url path', 'https://github.com/@dev'],
    ['two at signs', '@@dev'],
    ['a name that is too long', `@${'a'.repeat(65)}`],
  ])('ignores %s', (_name, text) => {
    expect(parseMentions(text)).toEqual([]);
  });

  it('ignores inline code spans of any backtick length', () => {
    expect(parseMentions('use `@dev` aqui')).toEqual([]);
    expect(parseMentions('use ``@dev ` @qa`` aqui')).toEqual([]);
    expect(parseMentions('`@dev` mas @qa fora')).toEqual(['qa']);
    // An unmatched backtick opens nothing.
    expect(parseMentions('um ` solto @dev')).toEqual(['dev']);
    expect(parseMentions('``abre e `fecha` @dev')).toEqual(['dev']);
  });

  it('ignores fenced code blocks, with or without a language, and unclosed ones', () => {
    expect(parseMentions('antes\n```\n@dev\n```\ndepois @qa')).toEqual(['qa']);
    expect(parseMentions('```ts\nconst x = "@dev";\n```\n@qa')).toEqual(['qa']);
    expect(parseMentions('~~~\n@dev\n~~~\n@qa')).toEqual(['qa']);
    expect(parseMentions('````\n```\n@dev\n```\n````\n@qa')).toEqual(['qa']);
    expect(parseMentions('```\n@dev\nnunca fecha @qa')).toEqual([]);
    // A tilde fence is not closed by backticks.
    expect(parseMentions('~~~\n@dev\n```\n@qa\n~~~\n@ops')).toEqual(['ops']);
  });

  it('ignores indented code blocks but not paragraph continuations', () => {
    expect(parseMentions('texto\n\n    @dev\n\n@qa')).toEqual(['qa']);
    expect(parseMentions('texto\n\n\t@dev\n    @ops\n\n@qa')).toEqual(['qa']);
    expect(parseMentions('um parágrafo\n    continua @dev')).toEqual(['dev']);
  });

  it('ignores quoted lines, nested quotes included', () => {
    expect(parseMentions('> @dev disse\n\n@qa responde')).toEqual(['qa']);
    expect(parseMentions('> > @dev\n>@ops\n  > @x\n\n@qa')).toEqual(['qa']);
    // A line after a quote with no blank line still belongs to the quote, as it renders.
    expect(parseMentions('> @dev disse\n@qa responde')).toEqual([]);
  });

  it('finds nothing in empty or mention-free text', () => {
    expect(parseMentions('')).toEqual([]);
    expect(parseMentions('só texto')).toEqual([]);
  });
});
