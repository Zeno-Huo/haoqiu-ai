import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import History from './pages/History'
import MatchNew from './pages/MatchNew'
import InstantAnalysis from './pages/InstantAnalysis'
import Analyzing from './pages/Analyzing'
import MatchReport from './pages/MatchReport'
import SingleTracking from './pages/SingleTracking'
import NotFound from './pages/NotFound'
import TrainingResult from './pages/TrainingResult'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/history" element={<History />} />
        <Route path="/match/new" element={<MatchNew />} />
        <Route path="/match/:id/instant" element={<InstantAnalysis />} />
        <Route path="/match/:id/tracking" element={<SingleTracking />} />
        <Route path="/match/:id/analyzing" element={<Analyzing />} />
        <Route path="/match/:id/training" element={<TrainingResult />} />
        <Route path="/match/:id" element={<MatchReport />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
