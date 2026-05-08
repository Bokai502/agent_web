import { StrictMode, lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { APP_NAVIGATION_EVENT } from './app/sessionUtils.ts'
import './styles/app.css'

const Viewer3D = lazy(() => import('./pages/Viewer3D.tsx'))
const Earth = lazy(() => import('./pages/Earth.tsx'))
const SplineShowcase = lazy(() => import('./pages/SplineShowcase.tsx'))
const WorkspaceAppleSample = lazy(() => import('./pages/WorkspaceAppleSample.tsx'))

function Router() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const handleNavigation = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handleNavigation)
    window.addEventListener(APP_NAVIGATION_EVENT, handleNavigation)
    return () => {
      window.removeEventListener('popstate', handleNavigation)
      window.removeEventListener(APP_NAVIGATION_EVENT, handleNavigation)
    }
  }, [])

  const isViewer = pathname === '/viewer'
  const isEarth = pathname === '/earth'
  const isHome = pathname === '/' || pathname === '/home'
  const isWorkspace = pathname === '/workspace' || pathname.startsWith('/workspace/')

  if (isViewer) {
    return (
      <Suspense fallback={<div style={{ background: '#1a1a2e', width: '100vw', height: '100vh' }} />}>
        <Viewer3D />
      </Suspense>
    )
  }

  if (isEarth) {
    return (
      <Suspense fallback={<div style={{ background: '#000', width: '100vw', height: '100vh' }} />}>
        <Earth />
      </Suspense>
    )
  }

  if (isHome) {
    return (
      <Suspense fallback={<div style={{ background: '#eef3f8', width: '100vw', height: '100vh' }} />}>
        <SplineShowcase />
      </Suspense>
    )
  }

  if (isWorkspace) return <App />

  return (
    <Suspense fallback={<div style={{ background: '#f5f5f7', width: '100vw', height: '100vh' }} />}>
      <WorkspaceAppleSample homePath="/workspace" />
    </Suspense>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
