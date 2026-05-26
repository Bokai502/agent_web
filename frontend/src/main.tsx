import { StrictMode, lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { APP_NAVIGATION_EVENT } from './app/sessionUtils.ts'
import './i18n.ts'
import './styles/app.css'

const ModelViewerPage = lazy(() => import('./pages/ModelViewerPage.tsx'))
const EarthPage = lazy(() => import('./pages/EarthPage.tsx'))
const HomePage = lazy(() => import('./pages/HomePage.tsx'))
const WorkspaceSessionPage = lazy(() => import('./pages/WorkspaceSessionPage.tsx'))
const GncWorkspacePage = lazy(() => import('./pages/GncWorkspacePage.tsx'))
const RegionWorkspacePage = lazy(() => import('./pages/RegionWorkspacePage.tsx'))

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
  const isGncWorkspace = pathname === '/gnc-workspace' || pathname.startsWith('/gnc-workspace/')
  const isRegionWorkspace = pathname === '/region-workspace' || pathname.startsWith('/region-workspace/')

  if (isViewer) {
    return (
      <Suspense fallback={<div style={{ background: '#1a1a2e', width: '100vw', height: '100vh' }} />}>
        <ModelViewerPage />
      </Suspense>
    )
  }

  if (isEarth) {
    return (
      <Suspense fallback={<div style={{ background: '#000', width: '100vw', height: '100vh' }} />}>
        <EarthPage />
      </Suspense>
    )
  }

  if (isHome) {
    return (
      <Suspense fallback={<div style={{ background: '#eef3f8', width: '100vw', height: '100vh' }} />}>
        <HomePage />
      </Suspense>
    )
  }

  if (isWorkspace) {
    return (
      <Suspense fallback={<div style={{ background: '#f5f5f7', width: '100vw', height: '100vh' }} />}>
        <WorkspaceSessionPage homePath="/workspace" />
      </Suspense>
    )
  }

  if (isGncWorkspace) {
    return (
      <Suspense fallback={<div style={{ background: '#f5f5f7', width: '100vw', height: '100vh' }} />}>
        <GncWorkspacePage />
      </Suspense>
    )
  }

  if (isRegionWorkspace) {
    return (
      <Suspense fallback={<div style={{ background: '#f5f5f7', width: '100vw', height: '100vh' }} />}>
        <RegionWorkspacePage />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<div style={{ background: '#f5f5f7', width: '100vw', height: '100vh' }} />}>
      <WorkspaceSessionPage homePath="/workspace" />
    </Suspense>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
