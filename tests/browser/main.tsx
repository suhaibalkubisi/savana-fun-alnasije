import React from 'react';
import {createRoot} from 'react-dom/client';
import {HRApp} from '../../components/hr/app';
import '../../app/globals.css';
import '../../app/workspace-theme.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><HRApp/></React.StrictMode>);
