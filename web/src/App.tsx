import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import MatchNew from './pages/MatchNew'
import InstantAnalysis from './pages/InstantAnalysis'
import SingleTracking from './pages/SingleTracking'
import NotFound from './pages/NotFound'

const DesignPreview = import.meta.env.DEV ? lazy(() => import('./pages/DesignPreview')) : () => null

export default function App() {
  return (
    <Layout>
      <Routes>
        {import.meta.env.DEV && <Route path="/design-preview" element={<Suspense fallback={null}><DesignPreview /></Suspense>} />}
        <Route path="/" element={<Home />} />
        <Route path="/match/new" element={<MatchNew />} />
        <Route path="/match/:id/instant" element={<InstantAnalysis />} />
        <Route path="/match/:id/tracking" element={<SingleTracking />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
