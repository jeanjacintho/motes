import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, test } from 'vitest';

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      Contagem: {count}
    </button>
  );
}

test('renders and interacts with a React component in the DOM', () => {
  render(<Counter />);
  const button = screen.getByRole('button', { name: 'Contagem: 0' });
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Contagem: 1' }).textContent).toBe('Contagem: 1');
});

test('cleans up the DOM between tests', () => {
  expect(screen.queryByRole('button')).toBeNull();
});
