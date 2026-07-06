import { createRoot } from 'react-dom/client';
import App from './App';

// No StrictMode on purpose: its dev double-invoke runs dagre/fitView twice and
// flickers the layout. The app is small and effect-light, so we don't need it.
createRoot(document.getElementById('root')!).render(<App />);
