import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import MatchNew from './pages/MatchNew'
import Analyzing from './pages/Analyzing'
import MatchReport from './pages/MatchReport'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/match/new" element={<MatchNew />} />
        <Route path="/match/:id/analyzing" element={<Analyzing />} />
        <Route path="/match/:id" element={<MatchReport />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
