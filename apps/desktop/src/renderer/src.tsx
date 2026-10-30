import '@motes/ui/tokens.css';
import { createRoot } from 'react-dom/client';
import { Desktop } from './app';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(<Desktop bridge={window.motes.pairing} />);
