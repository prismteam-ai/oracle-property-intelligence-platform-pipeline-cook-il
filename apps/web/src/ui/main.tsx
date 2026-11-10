import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components.js';
import { RunSummary } from './pages/RunSummary.js';
import { Runs } from './pages/Runs.js';
import { Publications } from './pages/Publications.js';
import { Query } from './pages/Query.js';
import { Explore } from './pages/Explore.js';
import { Agent } from './pages/Agent.js';
import { Mcp } from './pages/Mcp.js';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <RunSummary /> },
      { path: 'runs', element: <Runs /> },
      { path: 'publications', element: <Publications /> },
      { path: 'publications/:runId', element: <Publications /> },
      { path: 'query', element: <Query /> },
      { path: 'explore', element: <Explore /> },
      { path: 'agent', element: <Agent /> },
      { path: 'mcp', element: <Mcp /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
