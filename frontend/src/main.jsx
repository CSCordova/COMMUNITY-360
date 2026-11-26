import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import App from './App';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import './dashboard.css';
import './theme.css';
import './workspace.css';
import './motion.css';
import './analysis.css';
import './platform.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode><BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter></React.StrictMode>,
);
