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
    ['text under a nested list item', '- parent\n    - child\n\n      @dev', ['dev']],
    ['indented code under a nested list item', '- parent\n    - child\n\n          @dev', []],
    ['an indented list continuation', '- item\n\n    continua com @dev', ['dev']],
    ['emphasis around it', '**@dev** e *@qa*', ['dev', 'qa']],
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
    expect(parseMentions('> @dev disse\n@qa responde')).toEqual(['qa']);
    expect(parseMentions('> > @dev\n>@ops\n  > @x\n@qa')).toEqual(['qa']);
  });

  it('finds nothing in empty or mention-free text', () => {
    expect(parseMentions('')).toEqual([]);
    expect(parseMentions('só texto')).toEqual([]);
  });
});
